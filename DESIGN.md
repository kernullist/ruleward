# Agent Instruction Lint — 설계 문서

> AGENTS.md / CLAUDE.md / Cursor rules 등 **AI 에이전트 룰파일**을 분석해
> **충돌·중복·과대화(컨텍스트 낭비)** 를 잡고, **실제 코드와 어긋난 룰**을 감지하여
> 수정을 제안하는 린터 & 검증기.
>
> 명칭: `ruleward` (초기 코드네임은 `ail` = agent-instruction-lint).
> 문서 버전: **v0.3** (2026-05-31) — Instruction 개명 전 문서 적용 · Diagnostic/SARIF 모델 확정 · 5개 미결 항목 동결([docs/FROZEN-v0.3.md](docs/FROZEN-v0.3.md)).
>
> **심화 스펙(v0.2):** Instruction IR 형식 정의·추출 알고리즘, 충돌/드리프트 엔진 상세 알고리즘,
> 평가 하니스는 [docs/DEEP-DIVE.md](docs/DEEP-DIVE.md) 참조.
>
> **경쟁 코드 검증:** 실제 OSS 린터 `cclint`(felix/carl) 두 구현을 직접 정독해 차용·차별화 지점을
> 도출한 teardown은 [docs/cclint-teardown.md](docs/cclint-teardown.md) 참조. (요지: 둘 다 AST·토큰·
> 룰간분석·코드드리프트·SARIF가 없는 "구조 린터" → 우리 3대 차별축이 현실 코드로 검증됨.
> 단, "Rule" 용어 충돌 발견 → 추출 단위를 **Instruction**으로 개명 확정(v0.3, 아래 [용어 규약](#용어-규약-v03-확정)).)

---

## 0. TL;DR

- **시장 공백이 분명하다.** 이미 AgentLint·cclint·cursor-doctor·agnix 등 린터가 있지만, 이들은 전부 **구조/컴플라이언스 린팅**(파일 크기, 토큰 예산, 포맷, `.gitignore`/SHA-pinning 등)에 머문다. **(a) 룰 간 의미적 충돌**과 **(b) 룰 ↔ 실제 코드의 드리프트**를 잡는 도구는 사실상 없다. 우리의 차별점이 정확히 여기다.
- **핵심 설계 사상: "룰파일을 위한 컴파일러".** 이종(異種) 포맷을 하나의 정규화된 **Instruction IR**(중간 표현)로 파싱 → 그 위에서 4개 분석 패스(충돌/중복/과대화/드리프트)를 독립적으로 실행 → 진단(diagnostic) + 수정(fix) 생성. ESLint/컴파일러와 동일한 멘탈 모델.
- **코드 드리프트는 양방향이다.**
  - **Rule→Code (stale rule):** 룰이 더 이상 없는 심볼/경로/명령/의존성을 가리킴.
  - **Code→Rule (missing rule):** 코드에 `@deprecated` 같은 신호가 있는데 이를 막는 룰이 없음 ← *사용자가 든 헤드라인 예시("폐기한 유틸 쓰지 마라"가 누락)가 바로 이 케이스.*
- **거짓 양성(FP)이 린터를 죽인다.** 그래서 **신뢰도 계층화된 심각도 모델**을 1급 설계 원칙으로 둔다: 결정론적 검사만 `error`(CI 실패 가능), ML/LLM 추론은 `warning`/`suggestion`.
- **오프라인 우선.** 결정론 계층 + 로컬 모델(NLI/임베딩) 계층으로 코드를 외부에 안 보내고도 대부분 동작. LLM 계층은 opt-in. (코드 유출 못 하는 팀에 중요한 차별점.)
- **MVP는 ML 없이 시작.** 멀티포맷 파싱 + Instruction IR + 토큰 예산 + 룰↔설정 중복 + dangling 경로/명령/의존성 + key-value 설정 충돌. 이것만으로도 "코드 인지" 축에서 기존 도구를 앞선다.

---

## 용어 규약 (v0.3 확정)

> cclint 등 기존 도구는 "Rule"을 *린트 체크*의 의미로 쓴다([teardown](docs/cclint-teardown.md) §5-A). 우리 설계에선 같은 단어가 *추출된 지시문*을 가리켜 충돌하므로, v0.3부터 아래 용어로 고정한다.

| 용어 | 정의 |
|---|---|
| **룰파일 / instruction file** | 입력 아티팩트. `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*.mdc`, `copilot-instructions.md` 등. (업계 통용어라 유지) |
| **Instruction** | 룰파일에서 추출한 **원자 지시문** = Instruction IR의 노드. (구 "원자 룰") 모달리티 필드 `directive`(MUST/SHOULD…)와는 별개 개념. |
| **Instruction IR** | Instruction들의 정규화 중간표현. 4개 Engine의 공통 입력. (구 "Rule IR") |
| **Check** | 단일 분석 모듈. ID는 `engine/check` 형식(예: `conflict/setting-collision`). cclint의 "Rule"에 해당. |
| **Engine** | Check들의 묶음. 4종: `conflict` · `duplication` · `bloat` · `drift`. |
| **Diagnostic** | Check가 내는 진단 결과. 구조화 객체(§8, [FROZEN §2](docs/FROZEN-v0.3.md)). felix의 `Violation` 모양 채택, carl의 `string[]`은 회피. |

이 문서·[DEEP-DIVE](docs/DEEP-DIVE.md)의 의사코드에서 변수 `inst`/`rule`은 모두 **Instruction**을 가리킨다.

---

## 1. 문제 정의

AI 코딩 에이전트는 `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/*.mdc` 같은 **룰파일/지시문 파일**을 매 프롬프트의 시스템 컨텍스트로 주입받는다. 이 파일들은 시간이 지나며 다음 병리(病理)를 겪는다:

| 병리 | 증상 | 비용 |
|---|---|---|
| **충돌 (Conflict)** | "탭 써라" vs "스페이스 써라", "X 금지" vs "X 권장" | 모델이 조용히 한쪽을 임의 선택 → 비결정적 행동 |
| **중복 (Duplication)** | 같은 규칙 반복; `tsconfig.json`에 이미 있는 걸 룰로 또 씀 | 토큰 낭비, 신호 희석 |
| **과대화 (Bloat)** | "클린 코드 써라" 류 모호한 지시, 린터로 강제할 걸 산문으로 씀 | 매 요청마다 반복 과금되는 컨텍스트 낭비, "lost in the middle" |
| **코드 드리프트 (Drift)** | 폐기된 유틸을 막는 룰이 없음 / 룰이 없어진 파일을 가리킴 | 에이전트가 틀린 전제로 작업 → 버그 |

업계는 이미 이를 인지하고 있다. Thoughtworks Technology Radar는 *"Agent instruction bloat"* 를 명시적 안티패턴으로 등재했고, 한 실증 분석은 28개 룰 중 15개가 *설정 파일과 중복이거나 다른 곳(린터/CI)에 있어야 할 것*이었다고 보고한다. 연구(Galster et al.)는 룰파일의 **staleness(코드 진화 대비 노후화)** 와 **룰-코드 충돌**을 핵심 유지보수 부담으로 지목한다.

**핵심 통찰:** 이 파일들은 *코드처럼 진화하지만 코드처럼 검증받지 않는다.* 컴파일러·린터·테스트가 없는 "두 번째 소스코드"다. 우리가 만들 것이 그 빠진 검증 계층이다.

---

## 2. 기술·생태계 조사 (Landscape)

### 2.1 룰파일 포맷 지형

| 포맷 | 도구 | 구조 | 스코핑/로딩 | 비고 |
|---|---|---|---|---|
| **AGENTS.md** | Codex, Cursor, VS Code, Jules, Amp, Factory 등 30+ | 순수 Markdown, **스키마 없음**, 자유 heading | **중첩(nesting)**: 편집 파일에 가장 가까운 `AGENTS.md`가 우선; 유저 채팅이 전부 오버라이드 | Linux Foundation 산하 *Agentic AI Foundation*이 관리. 60,000+ 레포 |
| **CLAUDE.md** | Claude Code | Markdown + `@path` **import** 지원 | 프로젝트/유저(`~/.claude`)/엔터프라이즈 계층 병합 | 메모리 파일. `@import`로 분할 로딩 |
| **`.cursor/rules/*.mdc`** | Cursor | **YAML frontmatter** + Markdown | frontmatter: `description`, `globs`, `alwaysApply` → 4가지 로딩 모드(Always / Auto-Attached / Agent-Requested / Manual) | 레거시 `.cursorrules`와 공존 시 충돌 |
| **`.github/copilot-instructions.md`** | GitHub Copilot | Markdown | repo 전역; `applyTo` glob을 가진 `*.instructions.md`도 있음 | |
| **`.windsurfrules` / `.clinerules` / `.junie` 등** | Windsurf, Cline 등 | Markdown(±frontmatter) | 도구별 상이 | 파편화 |

**설계 함의:**
- AGENTS.md는 *스키마가 없다* → 우리가 의미를 **추론**해야 한다(아래 Instruction IR).
- **스코프(globs)와 로딩 모드(alwaysApply)** 가 충돌/과대화 분석의 1급 입력이다. "always 로딩인데 특정 폴더에만 의미 있는 룰" = 과대화. "스코프가 겹치는 두 룰이 모순" = 충돌.
- **중첩/우선순위 모델**이 "의도된 오버라이드 vs 버그"를 가르는 열쇠다.

### 2.2 기존 도구 분석 — 그리고 그들이 *안* 하는 것

| 도구 | 하는 것 | **안 하는 것 (= 우리의 공백)** |
|---|---|---|
| **AgentLint** (agentlint.app) | 5차원 33검사: Findability/Instructions/Workability/Continuity/Safety. 토큰·문자 상한(40K), 키워드 반복, `.env` gitignore, Actions SHA-pin. 일부 auto-fix | **룰 간 의미적 모순 ✗, 룰↔코드 일치 ✗, 아키텍처 정합성 ✗** |
| **cclint** | Claude Code 파일(에이전트/커맨드/설정/문서) 스펙 검증 | 의미 분석 ✗, 코드 드리프트 ✗ |
| **cursor-doctor** | A~F 등급, `.cursorrules` 레거시 충돌, 토큰 예산, `alwaysApply` 사용, 파일 크기 | 룰-룰 모순 ✗, 코드 드리프트 ✗ |
| **agnix** | skills/hooks/memory/plugins/MCP/agent 설정 린트, **LSP + IDE 플러그인** | 구조 검증 중심; 코드 드리프트 ✗ |
| **rule-porter** | `.mdc` → CLAUDE.md/AGENTS.md/Copilot 포맷 **변환** | 린팅 아님(변환기) |

**결론:** 전 영역이 **구조·포맷·정책(structural/compliance) 린팅**에 머문다. **의미 충돌 탐지**와 **코드 정합성(code-aware) 검증**은 비어 있다. 단, agnix의 **LSP/IDE 통합**과 AgentLint의 **scorecard/auto-fix**는 베껴야 할 좋은 UX다.

> **코드 정독으로 검증됨([teardown](docs/cclint-teardown.md)):** `cclint`(felix v0.14 / carl v0.2.10)는 둘 다 Markdown을 `lines[]`+정규식으로 읽는 구조 린터다. 특히 felix는 *"Catch CLAUDE.md drift"*를 표방하지만, 그 `ImportResolutionRule`은 **CLAUDE.md `@import` 링크 해석 + 순환참조**만 검사할 뿐 **실제 소스코드 심볼은 전혀 보지 않는다** — 즉 우리의 코드-드리프트와 *겹치지 않는다.* AST·토크나이저·룰간 분석·SARIF도 모두 부재.

### 2.3 학술·업계 근거

- **ContextCov** (arXiv 2603.00822) — *"Deriving and Enforcing Executable Constraints from Agent Instruction Files."* 지시문에서 실행 가능한 제약을 추출 → **런타임**에 에이전트 행동을 모니터링하며 위반/발산 탐지. 제약 분류: capability/behavior/output/policy.
  → **우리와의 관계: 상보적.** ContextCov는 *런타임 행동 감시*, 우리는 *정적/CI 시점의 룰-코드 정합성 검사*. 그들의 "constraint 추출" 단계가 우리 Instruction IR의 directive 추출과 겹친다 — 차용 가능.
- **Galster et al.** (arXiv 2602.14690) — *"Configuring Agentic AI Coding Tools: An Exploratory Study."* 지시문 taxonomy(시스템 제약 / 코드 품질·스타일 / 프로젝트 맥락·아키텍처 / 툴 사용 / 보안·안전)와, **노후화·룰-코드 충돌·일관성 부재**의 실증. → 우리 **카테고리 분류기**의 근거 taxonomy로 채택.
- **Thoughtworks Radar** — *"Agent instruction bloat"* 안티패턴. → 과대화 엔진의 정당화.
- **3-Question Audit** (현장 휴리스틱) — ① *설정 파일에서 보이나?* → 삭제 ② *툴로 강제 가능한가?* → 린터/CI로 이동 ③ *지우면 잘못된 결정을 부르나?* → 본질 vs 잡음. → 과대화·중복 엔진의 **판정 규칙**으로 직접 구현.
- **Specificity 지표** — 좋은 룰은 "정확히 하나의 경로"를, 나쁜 룰은 "해석의 자유도"를 준다. → 모호성 점수의 정의.

### 2.4 차용할 핵심 구현 기술

- **NLI cross-encoder** (`cross-encoder/nli-deberta-v3-base`, `dleemiller/ModernCE-*`): premise–hypothesis → {entailment, neutral, **contradiction**}. CPU에서 distill 버전 실시간 가능. → 충돌 엔진 Tier-A.
- **tree-sitter**: 컴파일 불필요, 의존성 가벼움, 다언어 동시 구문 트리 + 쿼리로 심볼/주석 추출. → 코드 인덱스 기본값.
- **SCIP** (Sourcegraph Semantic Code Intelligence Protocol): 언어 무관, human-readable 심볼 ID, 정밀한 cross-file 참조 해석(`scip-typescript`, `scip-python` 등). → 정밀 모드 opt-in.
- **universal-ctags**: 초경량 다언어 심볼 인덱스. → 폴백.
- **임베딩 + 토크나이저**: 의미 중복·예산 산정.

---

## 3. 핵심 설계 사상: 룰파일 컴파일러

```
                ┌──────────────────────────────────────────────────────────────┐
  repo  ───────►│  ① Discovery   ② Parse→Instruction IR   ③ Enrich   ④ Analyze   ⑤ Fix │──► 진단/리포트
  (코드+룰파일)  └──────────────────────────────────────────────────────────────┘
```

ESLint/컴파일러와 같다: **lex/parse → IR → 다중 분석 패스 → diagnostics → fix**. 핵심은 **Instruction IR**라는 단일 정규형. 이종 포맷 파싱의 지저분함을 분석 엔진과 **분리**한다. 새 포맷(차세대 도구)이 나와도 프론트엔드만 추가하면 4개 엔진을 그대로 재사용.

이 IR이 있어야 비로소:
- 충돌 = IR 노드 쌍의 모순 관계
- 중복 = IR 노드 간/노드↔설정-fact 간 유사·포함 관계
- 과대화 = IR 노드의 토큰·모호성·강제가능성 속성
- 드리프트 = IR 노드의 `code_referents` ↔ 코드 심볼 그래프 매칭

…이 전부 **같은 자료구조 위의 그래프 질의**로 표현된다.

---

## 4. 파이프라인 아키텍처

### ① Discovery & Loading
- 멀티포맷 파일 탐색(`AGENTS.md`, `CLAUDE.md`, `.cursor/rules/**`, `.github/**instructions.md`, `.windsurfrules`, `.clinerules`…).
- **중첩 트리** 구성 + **우선순위 모델**(가장 가까운 파일 우선). CLAUDE.md `@import` 해석.
- 각 파일에 **scope**(디렉토리 경계, `globs` frontmatter) 부착.

### ② Parse → Instruction IR
- Markdown AST (remark / comrak) → 섹션 트리.
- frontmatter(YAML) 파싱 → `description`/`globs`/`alwaysApply`.
- 섹션·불릿·명령문을 **Instruction(원자 지시문, atomic instruction)** 으로 분할. (한 불릿 = 보통 한 Instruction; 복문은 분리.)
- 각 룰에 대해 **추출기** 실행 → directive/polarity/code_referents/category (§5).

### ③ Enrichment
- **토크나이저**(Anthropic/tiktoken)로 룰·파일·"always-on" 합계 토큰 산정.
- **임베딩**(로컬, e.g. `bge-small`/`gte-small` via transformers.js) 부착.
- **코드 인덱스 빌드**: tree-sitter 심볼 추출(+옵션 SCIP/ctags) → 심볼 테이블, export 그래프, 의존성 매니페스트(package.json/pyproject/go.mod…), 설정 fact(§6.2).
- 모든 산출물은 **콘텐츠 해시 기반 캐시**(증분 분석).

### ④ Analyze (4대 엔진, §6)
- 각 엔진은 독립 패스. 입력: Instruction IR + 코드 인덱스. 출력: `Diagnostic[]`.

### ⑤ Fix Synthesis & Report (§7, §9)
- 진단마다 `fix` 액션. 심각도/신뢰도 부착(§8). SARIF/JSON/CLI/scorecard 출력.

---

## 5. Instruction IR 스키마

```jsonc
// 하나의 Instruction (룰파일에서 추출한 원자 지시문)
{
  "id": "agents-md::§Style::L42",              // 안정적 ID (파일#heading경로#라인)
  "source": { "file": "AGENTS.md", "line": 42, "headingPath": ["Code Style"] },
  "raw": "Never import from `src/legacy/*`; use `@core/*` instead.",
  "normalized": "import from src/legacy is prohibited; use @core instead",

  "directive": "MUST_NOT",   // RFC2119: MUST | MUST_NOT | SHOULD | SHOULD_NOT | MAY | INFO
  "polarity":  "prohibition",// requirement | prohibition | preference | statement
  "atomicity": "atomic",     // atomic | compound(분할 권장) | narrative(룰 아님)

  "scope": {                 // 어디에 적용되나
    "globs": ["**/*.ts"],    // .mdc globs 또는 중첩 디렉토리에서 유도
    "loading": "always",     // always | auto-attached | agent-requested | manual
    "dirBoundary": "/"       // 중첩 우선순위 계산용
  },

  "category": "architecture",// Galster taxonomy: style|quality|architecture|build|test|security|tooling|context|process
  "enforceability": {        // 3-Question Audit 결과
    "configVisible": false,  // 설정 파일에 이미 있나 → 중복 후보
    "toolEnforceable": "eslint(no-restricted-imports)", // 린터로 옮길 수 있나
    "decisionImpact": "high" // 지우면 잘못된 결정? high면 본질, none이면 잡음
  },

  "codeReferents": [         // 코드 정합성 검사 입력 (§6.4)
    { "kind": "path",    "value": "src/legacy/*", "confidence": 0.95 },
    { "kind": "path",    "value": "@core/*",      "confidence": 0.90 },
    { "kind": "symbol",  "value": "...",          "confidence": 0.0 }
  ],

  "settingKV": { "key": "import.restricted", "value": "src/legacy/*" }, // 추출 가능 시(설정형 룰)
  "tokens": 18,
  "embedding": [/* f32[384] */]
}
```

**추출기 세부:**
- **directive/polarity**: RFC2119 키워드(`must/never/always/should/prefer/avoid…`) + 명령문(imperative) 탐지. 다국어(한국어 "하지 마라/반드시/지양") 사전 포함.
- **atomicity**: 한 룰이 여러 절을 담으면 `compound` → 분할 제안. 설명 산문은 `narrative`로 분류해 룰 분석에서 제외(단 토큰엔 계상).
- **settingKV**: "indent = tabs", "max line length 100", "import from X 금지" 등 **키-값으로 환원 가능한 룰**을 정규화 — 충돌 엔진의 최고신뢰 입력.
- **codeReferents 추출**(§6.4): 결정론(backtick/경로/명령/패키지명) + NER/LLM 하이브리드, **신뢰도 부착**.

---

## 6. 4대 분석 엔진

> 공통 원칙: **신뢰도 계층화**(§8). 결정론적으로 확실한 것만 강하게 말한다.

### 6.1 충돌 엔진 (Conflict)

**충돌 유형**
1. **설정값 충돌**(deterministic): `settingKV`가 같은 `key`인데 `value`가 다름 (탭 vs 스페이스). → **최고신뢰, error.**
2. **직접 모순**(NL): "X 써라" vs "X 쓰지 마라".
3. **모달 충돌**: "절대 X 금지" vs "Y일 때 X 사용" (절대 vs 조건부).
4. **스코프 중첩 충돌**: 룰 A(`**/*.ts`)와 B(`src/**`)가 스코프가 겹치며 모순.

**3-Tier 파이프라인 (비용·정밀도 균형)**
```
모든 룰 쌍
  └─► [후보 생성] 스코프 겹침 ∧ 임베딩 유사(동일 토픽 클러스터)  ── O(n²)이지만 수백개면 OK, LLM 호출 격감
        └─► Tier-0 (symbolic): settingKV 키 충돌 → 결정론적 판정      [error, 신뢰도 0.99]
        └─► Tier-A (NLI):      deberta-nli(premise,hypothesis)=contradiction? [warning, 로컬·무료]
        └─► Tier-B (LLM-judge): NLI가 애매(0.4~0.7)한 고유사 쌍만 LLM으로 구조화 판정
                                {conflict, type, which_wins?, explanation}  [suggestion, opt-in]
```

**의도된 오버라이드 vs 버그** — 우선순위 모델로 판별:
- *더 구체적 스코프*가 *덜 구체적 스코프*를 모순 → **합법 오버라이드** → `info`("scoped override here").
- *동일 스코프*에서 모순 → **버그** → `error`/`warning`.

**알려진 난점:** NLI는 서술문으로 학습됨 → 명령문엔 off-distribution. 대응: `normalized`에서 "Use X" → "The code uses X"로 변환 후 투입, 또는 명령문 쌍으로 소량 fine-tune. (리스크로 명시.)

### 6.2 중복 엔진 (Duplication)

**(A) 룰–룰 중복**
- **near-exact**: MinHash/SimHash.
- **paraphrase**: 임베딩 코사인 ≥ τ → cross-encoder 재랭킹으로 확정.
- **포함(subsumption)**: IR에서 A의 (scope ⊇ B.scope) ∧ (directive 동일) → B는 잉여. → "A로 통합".

**(B) 룰–설정 중복 (가장 가치 높음 — "Visibility Check")**
설정 파일에서 **fact**를 추출하는 소형 추출기 라이브러리를 둔다:

| 설정 소스 | 추출 fact 예 |
|---|---|
| `package.json` | 언어/프레임워크/deps/scripts (`"use TypeScript"`, `"run tests with jest"` 매칭) |
| `tsconfig.json` | `strict`, `paths` 별칭 |
| `.prettierrc`/`.editorconfig` | indent, quote, semicolon, lineWidth |
| `.eslintrc`/`eslint.config` | 켜진 규칙 ID (`no-var` 등) |
| CI yml | build/test 커맨드 |

룰이 이 fact를 재진술하면 → `redundant-with-config` 진단 + **"삭제"** fix. (예: `tsconfig` 있는데 "Use TypeScript" 룰.)

### 6.3 과대화 엔진 (Bloat / 컨텍스트 낭비)

이 파일들은 **매 프롬프트에 반복 주입** → 토큰은 *재발 비용*. 측정 지표:

- **토큰 예산**: always-on 합계(root AGENTS.md + CLAUDE.md + `alwaysApply` 룰). 임계 초과 경고(권장 always-on ≲ 2K tok; 하드 상한 40K char 참고). 룰별 토큰 표시.
- **모호성/specificity 점수**: "클린 코드", "best practice", "주의해서" 등 비실행 충전재. 휴리스틱: (구체적 referent 수)/(추상 형용사 수). 0이면 *"해석 자유도 무한"* → flag. (LLM 보조 스코어 opt-in.)
- **툴 강제 가능 룰의 오배치**: "no var", "use semicolons", "no console.log" → **ESLint/Prettier로 이동** 제안 + **설정 스니펫 diff** 자동 생성.
- **로딩 전략 부적합**: 특정 폴더에만 의미 있는 룰이 `always`로 로딩됨 → glob 스코핑 또는 on-demand(참조 파일/skill)로 분리 제안.
- **강조 인플레이션**: "IMPORTANT" 남발, 중복 prose, hedging.
- **lost-in-the-middle**: 과대 파일 → 구조 분할 권고.

판정은 **3-Question Audit**를 코드화: `configVisible→삭제`, `toolEnforceable→이동`, `decisionImpact=none→삭제 후보`.

### 6.4 코드 드리프트 엔진 (Code Drift) — 가장 novel·가장 어려움

룰의 `codeReferents`를 **코드 인덱스**(tree-sitter 심볼 + 옵션 SCIP/ctags + 파일시스템 + 의존성 매니페스트)에 해석(resolve)한다. **양방향:**

#### (A) Rule → Code : stale rule / dangling reference
| 진단 | 조건 | 신뢰도 |
|---|---|---|
| `dangling-path` | 룰이 가리키는 파일/glob이 존재 안 함 | **high (결정론)** |
| `stale-command` | "run `npm run build`" 인데 `build` 스크립트 없음 | **high** |
| `stale-dependency` | "we use Redux" 인데 `redux`가 매니페스트에 없음 | **high** |
| `broken-alias` | "import from `@/lib/x`" 인데 `@` 별칭 미설정 | **high** |
| `stale-symbol` | "use `OldClient`" 인데 심볼 테이블에 없음 | medium (이름 모호) |

#### (B) Code → Rule : missing / contradicted rule  ★ 사용자의 헤드라인 예시
**deprecation 디텍터**가 핵심. 코드에서 폐기 신호를 찾고, *이를 막는 룰이 있는지* 역으로 확인:

| 언어 | 폐기 마커 | tree-sitter 추출 |
|---|---|---|
| TS/JS | `@deprecated` JSDoc/TSDoc | 주석+선언 노드 |
| Python | `@deprecated`, `warnings.warn(DeprecationWarning)` | decorator/call |
| Java | `@Deprecated` | annotation |
| C# | `[Obsolete("...")]` | attribute |
| Go | `// Deprecated:` 관례 | doc comment |
| Rust | `#[deprecated(note=...)]` | attribute |

```scheme
;; 예: TS @deprecated 심볼 + 대체안 추출 (tree-sitter query)
(comment) @doc
  (#match? @doc "@deprecated")
. (export_statement (function_declaration name: (identifier) @deprecated.name))
```

- 폐기 심볼 `X` 발견 → **어떤 룰도 `X`를 언급/금지하지 않으면** → `missing-guard-rule` **suggestion**:
  *"`X`가 코드에서 deprecated 표시됨(대체: `Y`). 룰파일에 '`X` 사용 금지, `Y` 사용' 추가 권장."* (대체안 `Y`는 deprecation 메시지에서 파싱.)
- **강화 신호:** 폐기 심볼이 *최근에도 신규 사용*되고 있으면 우선순위 상승.

**기타 Code→Rule 신호**
- 룰 "no `eval`" 인데 코드에 `eval` 호출 존재 → `rule-violated-by-code`(룰은 진짜인데 안 지켜짐 → 린트 후보 or stale).
- `dependency-cruiser`/`import-linter`로 강제되는 아키텍처 경계가 룰에 문서화 안 됨/틀림.

#### 코드 referent 추출 (드리프트의 입력)
하이브리드, **신뢰도 게이팅 필수**:
1. **결정론(고신뢰)**: backtick 스팬, 경로꼴 토큰, 알려진 패키지명, CLI 커맨드.
2. **NER/LLM(저신뢰)**: 평문 속 엔티티("the old client") 추출·분류. **고신뢰만 resolve**해 FP 억제.
   - 함정: "use the **Button**" — `Button`은 심볼인가 영어 단어인가? → 신뢰도 게이트 + 심볼 테이블에 실제 존재할 때만 채택.

#### 코드 인덱스 계층화
- **기본**: tree-sitter(컴파일 불필요, 다언어, 빠름) — 정의/export 추출.
- **정밀 opt-in**: SCIP 인덱서(정확한 cross-file 참조; "정말 안 쓰임" 판정 가능).
- **폴백**: universal-ctags(언어 커버리지 폭).

> 드리프트는 본질적으로 FP가 높다 → (A)의 결정론 검사만 `error`, 심볼 이름 매칭과 (B) 추론은 `warning`/`suggestion`, 기본적으로 CI 하드실패 금지.

---

## 7. 수정 제안 (Fix Synthesis)

진단마다 fix 액션을 부착. 3등급:

| 등급 | 방식 | 예 |
|---|---|---|
| **Auto (결정론)** | 안전, 무인 적용 가능 | 중복 룰 삭제, near-dup 병합, 설정-재진술 룰 삭제, 강조 정규화, dangling 경로를 rename-detection으로 신경로 제안 |
| **Assisted (LLM)** | 제안 → 사람 검토 | 모호 룰을 구체화 재작성, 모순 두 룰을 하나로 병합, **누락 deprecation 가드 룰 초안**, 툴-이동 시 eslint/prettier 설정 diff 생성 |
| **Manual (flag만)** | 사람 결정 필요 | 진짜 의미 충돌(둘 중 뭐가 맞는지) |

- 항상 **diff로 미리보기**. `--fix`(auto만) / `--fix=assisted`(LLM 포함, 확인) / interactive. **무인 silent 재작성 금지.**
- LLM fix는 nondeterministic → 캐시 + 사람 승인 게이트.

---

## 8. 심각도·신뢰도 모델 (FP가 제품을 죽인다)

> *늑대 소년이 된 린터는 꺼진다.* FP 예산이 **최우선 제품 지표**.

```
신뢰도(confidence)  ──►  심각도(severity)  ──►  CI 동작
deterministic (≥0.95)     error                 실패 가능 (--max-severity=error)
local-ML     (0.6~0.95)   warning               비실패 (기본)
LLM/heuristic(<0.6)       suggestion/info        리포트만
```

- 엔진별·검사별 **신뢰도 캘리브레이션**을 벤치마크(§11)로 측정해 임계 조정.
- 사용자는 `.ailrc`로 검사 on/off·임계·심각도 override.
- **기본값은 보수적**: 새 사용자가 첫 실행에서 노이즈 폭탄을 맞지 않게.

---

## 9. 구현 스택 & 배포

### 9.1 스택 결정 (권장안 + 대안)

| 결정 포인트 | 권장 | 근거 | 대안 |
|---|---|---|---|
| 코어 언어 | **TypeScript/Node** | 대상 사용자가 npm 생태계; remark·tree-sitter(WASM)·tiktoken·SCIP·transformers.js 다 있음; `npx ail` 배포가 경쟁사 관례 | Rust(comrak+tree-sitter native, 빠름) + ML은 sidecar |
| 로컬 ML | **transformers.js / onnxruntime** (단일 바이너리, Python 불요) | 오프라인·무설치 차별점 | Python sidecar(모델 선택폭↑) |
| 코드 인덱스 | tree-sitter 기본 / SCIP opt-in / ctags 폴백 | §6.4 | LSP 질의(무겁고 환경의존) |
| 출력 | **SARIF** + JSON + pretty CLI + scorecard | GitHub code scanning 직결, CI 표준 | 자체 포맷 |
| 확장성 | **ESLint식 룰 플러그인** (각 검사 = IR+인덱스 위 모듈) | 커뮤니티 규칙 확장 | 모놀리식 |
| 에디터 | **LSP 서버**(룰파일 편집 중 실시간 진단) | agnix 선례, 즉각 가치 | CLI only |
| CI | GitHub Action + pre-commit hook + 종료코드 | 채택 마찰↓ | |
| 프라이버시 | **오프라인 우선**, LLM opt-in | 코드 유출 불가 팀 공략 | 클라우드 SaaS |
| 성능 | 콘텐츠 해시 캐시(인덱스·임베딩), 변경분만 재분석 | 대형 레포 드리프트 비용 | 전체 재분석 |

### 9.2 인터페이스 스케치
```bash
ruleward check .                 # 전체 검사, pretty 출력
ruleward check --format sarif    # CI/code-scanning
ruleward check --engine drift    # 특정 엔진만
ail fix --safe              # auto 등급만 적용
ail fix --assisted          # LLM 제안 포함, 대화형 확인
ail score                   # A~F scorecard + 추세
ail explain <diagnostic-id> # 근거·소스 라인 표시
```
`.ailrc.json`: 엔진/검사 토글, 토큰 예산, 심각도 매핑, LLM provider, 무시 경로.

---

## 10. 단계별 로드맵

| Phase | 내용 | ML/LLM | 가치 |
|---|---|---|---|
| **0 — MVP (결정론)** | 멀티포맷 Discovery + Instruction IR + 토큰예산 + 룰↔설정 중복(Visibility) + dangling 경로/명령/의존성 + key-value 설정 충돌 | 없음 | **FP 거의 0**, 즉시 기존 도구의 "코드 인지" 공백 점유 |
| **1 — 로컬 ML** | 임베딩 룰-룰 중복, NLI 충돌, 모호성 점수 | 로컬(오프라인) | 의미 분석 진입 |
| **2 — 드리프트 심화** | tree-sitter 심볼 인덱스, **deprecation 디텍터**, Code→Rule 누락 룰 제안, SCIP opt-in | 로컬 | **헤드라인 기능** 완성 |
| **3 — LLM 보조** | fix 합성, 의미 충돌 판정, 누락 룰 초안 | LLM opt-in | 수정 자동화 |
| **4 — 통합** | LSP, GitHub Action, scorecard 추세 | — | 채택·리텐션 |

MVP를 *결정론·고신뢰*로 못박는 게 전략의 핵심: 신뢰를 먼저 사고, 그 위에 추론 기능을 얹는다.

---

## 11. 평가 방법

- **planted-fault 벤치마크 코퍼스**: 공개 레포 N개의 실제 AGENTS.md/CLAUDE.md 수집 + **합성 결함 주입**:
  - 모순 룰 심기 / 심볼 rename으로 stale 참조 유발 / 설정-중복 룰 주입 / 폐기 마커 추가 후 가드 룰 누락.
- 엔진별 **precision/recall** 측정, **FP율을 1급 지표**로 추적.
- 심각도 게이트: 결정론 검사만 error로 승격할 수 있는지 캘리브레이션.
- dogfooding: 우리 레포의 룰파일에 자체 적용 + 인기 OSS 레포에 dry-run 리포트.

---

## 12. 리스크 & 열린 질문

**기술 리스크**
- NLI의 명령문 off-distribution(§6.1) → 정규화/소량 fine-tune 필요.
- 코드 referent 추출 FP("Button" 모호성) → 신뢰도 게이트 의존.
- Code→Rule 누락 탐지 = 최고가치·최고FP → 기본 보수적, suggestion-only.
- 다언어 코드 인덱스 커버리지(tree-sitter grammar 가용성).
- 중첩 파일의 "오버라이드 vs 버그" 모호성.
- LLM 계층의 비용·비결정성 → 캐시·티어·opt-in.

**열린 결정 (사용자 입력 필요)**
1. **코어 언어/런타임**: TS(권장) vs Rust vs Python?
2. **1차 지원 포맷 범위**: AGENTS.md+CLAUDE.md만? Cursor `.mdc`까지? 전부?
3. **LLM 사용 정책**: 오프라인 전용? API opt-in 허용?
4. **배포 형태**: 개인 CLI 도구 vs 팀 제품(SaaS/Action) vs OSS 라이브러리?
5. **명칭**: `ruleward`로 확정.

---

## 13. 참고자료

- AGENTS.md spec — https://agents.md
- AGENTS.md Complete Guide 2026 — https://codersera.com/blog/agents-md-complete-guide-2026/
- Top AI Agent Standards 2026 — https://blog.agentailor.com/posts/top-ai-agent-standards-2026
- ContextCov (executable constraints from instruction files) — https://arxiv.org/abs/2603.00822 (pdf: /pdf/2603.00822)
- Galster et al., Configuring Agentic AI Coding Tools: An Exploratory Study — https://arxiv.org/pdf/2602.14690
- Thoughtworks Radar — Agent instruction bloat — https://www.thoughtworks.com/radar/techniques/agent-instruction-bloat
- "I Analyzed Dozens of AI Agent Rules Files…" — https://dev.to/alexefimenko/i-analyzed-a-lot-of-ai-agent-rules-files-most-are-making-your-agent-worse-2fl
- Augment — Your agent's context is a junk drawer — https://www.augmentcode.com/blog/your-agents-context-is-a-junk-drawer
- AgentLint — https://www.agentlint.app/
- cclint — https://github.com/carlrannaberg/cclint , https://github.com/felixgeelhaar/cclint
- "The missing linter for AI coding assistants" (anthropics/skills #354) — https://github.com/anthropics/skills/issues/354
- NLI cross-encoders (sentence-transformers) — https://sbert.net/examples/cross_encoder/training/nli/README.html
- Targeted Entailment/Contradiction pipeline — https://arxiv.org/abs/2508.17127
- SCIP — https://sourcegraph.com/blog/announcing-scip
- tree-sitter — https://github.com/tree-sitter/tree-sitter
- universal-ctags — https://github.com/universal-ctags/ctags
