# FROZEN v0.3 — 구현 계약 (Implementation Contract)

> 이 문서는 **동결(frozen)** 결정의 단일 출처다. [DESIGN.md](../DESIGN.md)(개요)·[DEEP-DIVE.md](DEEP-DIVE.md)(알고리즘)·[cclint-teardown.md](cclint-teardown.md)(현실 검증)에서 도출한 결정을 *구현 직전 상태*로 확정한다.
> 변경하려면 이 문서를 고치고 버전을 올린다.

## 0. 동결 상태 요약

| 항목 | 상태 | 위치 |
|---|---|---|
| 용어(Instruction/Check/Engine/Diagnostic) | 🔒 LOCKED | [DESIGN 용어 규약](../DESIGN.md#용어-규약-v03-확정) |
| Diagnostic / Severity / SARIF 모델 | 🔒 LOCKED | §2 |
| settingKV 온톨로지 v1 | 🔒 LOCKED | §3 |
| Modality 사전 v1 (en/ko) | 🔒 LOCKED | §4 |
| NLI fine-tune 채택 여부 | 🔒 DECIDED (phased) | §5 |
| tree-sitter 1차 언어셋 | 🔒 LOCKED | §6 |
| 스택·포맷·LLM정책·배포 | 🔒 LOCKED (default) | §7 |
| 잔여 미결(구현 중 결정) | 🟡 OPEN | §8 |

---

## 1. 용어 (요약)

전체 표는 [DESIGN 용어 규약](../DESIGN.md#용어-규약-v03-확정). 요점만:
**룰파일**(입력) → 파싱 → **Instruction**(원자 지시문, IR 노드) → 4개 **Engine**의 **Check**들이 분석 → **Diagnostic**(진단) 출력.

---

## 2. Diagnostic / Severity / SARIF 모델 🔒

teardown 결론 채택: felix의 구조화 `Violation`을 따르고, carl의 `string[]`은 회피.

```ts
type Severity = 'error' | 'warning' | 'info';   // level 2 | 1 | 0, isAtLeast()로 게이팅

interface Loc { file: string; line: number; col?: number; endLine?: number; endCol?: number; }

interface Diagnostic {
  checkId: string;          // "engine/check" — 예: "conflict/setting-collision"
  engine: 'conflict' | 'duplication' | 'bloat' | 'drift';
  severity: Severity;
  confidence: number;       // 0..1 (§8 신뢰도→심각도 매핑의 입력)
  message: string;
  location: Loc;            // 1차 위치(보통 룰파일)
  related?: { loc: Loc; role: string }[];  // 충돌/중복=다른 Instruction, 드리프트=코드 심볼 위치
  fix?: Fix;                // §아래
  fingerprint: string;      // 런-간 안정 ID(노이즈 억제) = hash(checkId, 정규화된 대상)
}

type Fix =
  | { kind: 'auto';     edits: TextEdit[] }            // 결정론, 무인 적용 가능
  | { kind: 'assisted'; prompt: string; preview?: TextEdit[] }  // LLM 제안, 검토 필요
  | { kind: 'manual';   options: string[] };           // 사람 결정
```

**Check ID 네임스페이스(동결):** `conflict/*`, `duplication/*`, `bloat/*`, `drift/*`.
초기 Check ID 카탈로그(확장 가능):
`conflict/setting-collision`, `conflict/prohibit-vs-require`, `conflict/nli-contradiction`, `conflict/modal`, `conflict/scoped-override`(info);
`duplication/rule-rule`, `duplication/subsumption`, `duplication/redundant-with-config`;
`bloat/token-budget`, `bloat/vague`, `bloat/move-to-tool`, `bloat/loading-misfit`, `bloat/emphasis-inflation`;
`drift/dangling-path`, `drift/stale-command`, `drift/stale-dependency`, `drift/broken-alias`, `drift/stale-symbol`, `drift/missing-guard-rule`, `drift/rule-violated-by-code`.

**SARIF 2.1.0 매핑(동결):** [teardown §6](cclint-teardown.md) 스케치를 정본으로. 요약: `Diagnostic.checkId→result.ruleId`, `severity→level`(error/warning/**note**(=info)), `location→physicalLocation`, `related→relatedLocations`, `fix(auto)→fixes[].artifactChanges`, `confidence→properties.confidence`, `fingerprint→partialFingerprints`. 배포는 `github/codeql-action/upload-sarif`.

---

## 3. settingKV 온톨로지 v1 🔒

Instruction에서 "키-값으로 환원 가능한 룰"을 정규 키로 매핑(추출은 [DEEP-DIVE §A.3](DEEP-DIVE.md)). **충돌형(conf-type)**:
`closed`=값 도메인 열거형 → 값 불일치 시 결정론 충돌 / `scalar`=수치 → 다르면 충돌 / `singleton`=단일 정본 기대 → 서로 다른 값 둘 이상이면 충돌 / `set`=집합(prohibit∩prefer 교집합이 충돌).

| canonical key | conf-type | 값 도메인 | en 트리거 | ko 트리거 |
|---|---|---|---|---|
| `style.indent` | closed | `tab\|space` | use tabs, indent with spaces | 탭/스페이스 사용, 들여쓰기 |
| `style.indentSize` | scalar | int | 2-space, 4 spaces | N칸 들여쓰기 |
| `style.quotes` | closed | `single\|double` | single/double quotes | 작은/큰따옴표 |
| `style.semicolons` | closed | `required\|forbidden` | no semicolons, require semis | 세미콜론 필수/금지 |
| `style.lineLength` | scalar | int | max N chars, line length | 한 줄 N자 |
| `style.trailingComma` | closed | `all\|none\|es5` | trailing comma | 후행 쉼표 |
| `style.commentLanguage` | closed | `en\|ko\|…` | comments in English | 주석은 한글로 |
| `naming.case.<target>` | closed | `camel\|snake\|pascal\|kebab\|screamingSnake` | camelCase for vars, PascalCase classes | 변수는 카멜, 클래스는 파스칼 |
| `imports.restricted` | set | glob 집합 | don't import from X, no imports from | X import 금지 |
| `imports.preferred` | set | glob | import from X, use X alias | X에서 import |
| `imports.style` | closed | `named\|default\|namespace` | named imports only | named import만 |
| `module.boundaries` | set | layer 규칙 | layer X must not depend on Y | X는 Y 의존 금지 |
| `testing.framework` | singleton | string | use jest/pytest/vitest | jest로 테스트 |
| `testing.location` | closed | `colocated\|separate` | tests next to source, __tests__ dir | 테스트는 옆에/별도 |
| `testing.coverageMin` | scalar | int | min coverage N% | 커버리지 N% 이상 |
| `lang.version` | singleton | semver/string | target ES2022, Python 3.11+ | 파이썬 3.11 이상 |
| `packageManager` | closed | `npm\|yarn\|pnpm\|bun` | use pnpm | pnpm 사용 |
| `runtime` | singleton | `node\|deno\|bun\|…` | run on node | 노드에서 |
| `async.style` | closed | `asyncAwait\|promises\|callbacks` | prefer async/await | async/await 선호 |
| `errorHandling.style` | closed | `exceptions\|resultType\|errorReturn` | throw vs return errors | 예외/결과타입 |
| `exports.style` | closed | `named\|default` | no default exports | default export 금지 |
| `logging.framework` | singleton | string | use pino/winston | 로깅은 pino |
| `commit.format` | singleton | `conventional\|<custom>` | conventional commits | 컨벤셔널 커밋 |
| `branch.naming` | singleton | pattern | feature/<x> branches | 브랜치 네이밍 |

값 정규화 동의어 사전: `tabs\|tabulation→tab`, `2\|two\|둘→2`, `jest@*→jest` 등. 닫힌/수치 키는 충돌 신뢰도 **0.99**. `<target>` 파라미터 키는 동일 target일 때만 비교.

> v1 = 24키. 확장은 이 표에 행 추가 + 트리거/정규화만 등록(코드 변경 불필요하게 데이터 주도로 설계).

---

## 4. Modality 사전 v1 (en/ko) 🔒

Instruction의 `directive`/`polarity` 추출용([DEEP-DIVE §A.2](DEEP-DIVE.md)). **최강 매칭 우선**, 부정어가 polarity를 뒤집음.

| directive | polarity(긍정문) | en 트리거 | ko 트리거 |
|---|---|---|---|
| `MUST` | requirement | must, always, required, shall, need to, have to, ensure | 반드시, 항상, 필수, 무조건, 해야 한다, 보장 |
| `MUST_NOT` | prohibition | must not, never, do not, don't, forbidden, disallowed, prohibited, no `<X>` | 하지 마라, 하지 말 것, 금지, 절대 ~말 것, ~면 안 된다 |
| `SHOULD` | requirement(약) | should, prefer, recommended, encouraged, ideally, favor | 권장, ~하는 게 좋다, 지향, 가급적, 선호 |
| `SHOULD_NOT` | prohibition(약) | should not, avoid, discouraged, try not to | 지양, 피하라, ~안 하는 게 좋다 |
| `MAY` | preference | may, can, optional, feel free, if needed | ~해도 된다, 선택적, 필요하면 |
| `INFO` | statement | (트리거 없음 + 서술문) | (트리거 없음 + 서술문) |

**부정어 사전:** en `not, no, never, without, n't, avoid` · ko `안, 못, 없이, 말 것, 마라, 아니, 금`.
**명령문 탐지(`is_imperative`):** en = 문장이 동사원형으로 시작 + 명시 주어 부재 / ko = 명령형 종결어미(`~해라/~하라/~할 것/~하지 마라/~하세요`) 또는 동사 명령형.
**규칙:** ① 사전 최강 매칭으로 등급 결정 ② 부정어 동반 시 polarity 반전(`never use` → MUST_NOT) ③ 트리거 없고 명령문이면 `SHOULD`, 서술문이면 `INFO`.
i18n: v1은 en/ko. 추가 언어는 트리거 열 추가로 확장(데이터 주도).

---

## 5. NLI fine-tune — DECIDED: 채택(단계적) 🔒

**결정:** 채택하되 단계적.
- **Phase 1 (먼저 출시):** fine-tune 없이 **declarativize + zero-shot NLI**([DEEP-DIVE §B.3](DEEP-DIVE.md))로 충돌 Tier-A 가동. 빠르게 가치 확보, settingKV(Tier-0)가 고신뢰 충돌을 이미 결정론으로 잡으므로 NLI는 보조.
- **Phase 1.5 (fast-follow):** settingKV 온톨로지로 **합성 명령문-쌍 데이터 자동생성** → 소량 fine-tune로 "명령문 off-distribution" 갭 해소.

**합성 데이터 생성 스펙(동결):**
- **contradiction**: 각 `closed/scalar/singleton` 키의 서로 다른 값 쌍을 directive 템플릿에 끼워 생성(예: "Use tabs." ↔ "Use spaces.", "Always use X." ↔ "Never use X."). en/ko 양쪽.
- **entailment**: 같은 키·값의 패러프레이즈 쌍.
- **neutral**: 다른 키, 또는 같은 키 다른 `<target>`.
- **볼륨**: 10~30k 합성 + AllNLI(SNLI+MNLI) 혼합으로 베이스 망각 방지.
- **베이스 모델**: `cross-encoder/nli-deberta-v3-base`(또는 `ModernCE-large-nli`) → CPU용 distill. ko 비중 위해 mDeBERTa 변형 검토.
- **평가**: 홀드아웃 합성 + 평가 하니스([DEEP-DIVE §D](DEEP-DIVE.md))의 planted 충돌로 P/R 측정, 임계 캘리브레이션.

---

## 6. tree-sitter 1차 언어셋 v1 🔒

코드 인덱스([DEEP-DIVE §C.2](DEEP-DIVE.md)) 기본 빌더 = **web-tree-sitter(WASM grammar 번들)** — 네이티브 툴체인 불필요, 오프라인. SCIP는 정밀 opt-in, ctags는 폭 폴백.

| Tier | 언어 | deprecation 관용구(동결, [§C.4](DEEP-DIVE.md)) |
|---|---|---|
| **1 (MVP/Phase-2)** | **TypeScript, JavaScript(+JSX), Python, Go** | `@deprecated` JSDoc/TSDoc · `@deprecated`/`DeprecationWarning` · `// Deprecated:` |
| **2 (fast-follow)** | Java, C#, Rust, Ruby, PHP, Kotlin | `@Deprecated` · `[Obsolete]` · `#[deprecated]` · (Ruby/PHP/Kotlin 관용구 추가) |

Tier-1 선정 근거: AI 코딩 에이전트 사용자층 지배적 + tree-sitter grammar 성숙 + 명확한 폐기 관용구. 각 언어별 **심볼 추출 쿼리 + 폐기 쿼리**를 grammar와 함께 패키징.

---

## 7. 스택·포맷·정책·배포 — LOCKED (default) 🔒

DESIGN §12의 제품 결정을 기본값으로 동결(사용자가 override 가능):

| 결정 | 동결 값 | 근거 |
|---|---|---|
| 코어 언어 | **TypeScript + Node ≥18, ESM-only** | 대상 사용자 npm 생태계; 두 cclint 모두 동일 선택(검증됨) |
| Markdown 파싱 | **remark/unified(mdast) AST** | teardown 차별축 #1(둘 다 regex) |
| frontmatter | **gray-matter + zod**(+유저 customValidation) | carl 검증 패턴 채택 |
| 토크나이저 | **gpt-tokenizer(o200k_base) 기본, 교체 가능** | 정확 토큰 예산; Claude 토큰화와 미세차이는 예산 추정엔 무방 |
| 로컬 ML | **transformers.js + onnxruntime-web** (임베딩 `bge-small`/`gte-small`, NLI deberta-onnx) | 오프라인·무설치 |
| LLM 정책 | **opt-in, 기본 OFF**; 결정론+로컬 계층은 LLM 불요, 코드 미유출 | 프라이버시 차별점 |
| 1차 포맷 | **AGENTS.md · CLAUDE.md · `.cursor/rules/*.mdc`** (Tier-1) / copilot·windsurf·cline (Tier-2) | 채택률 |
| 표면 | CLI(commander, MVP) · GitHub Action+SARIF(P1) · MCP 서버(P2) · LSP(P4) · watch(chokidar) | teardown 채택 |
| 출력 | **SARIF 2.1.0(주) + pretty CLI + JSON** | code-scanning 직결 |
| 진단 모델 | **구조화 Diagnostic**(§2) | felix Violation 채택, carl string[] 회피 |
| 설정 파일 | `.ailrc.json` (+ JS/TS config로 프로그래매틱 Check) | cclint 관례 |
| 명칭 | 작업명 `ail` 유지, 최종명 TBD(낮은 우선순위) | — |

---

## 8. 잔여 미결 — OPEN (구현 중 결정, 비차단) 🟡

- 임베딩/NLI 모델 정확 핀(버전·크기)·임계 → 평가 하니스로 캘리브레이션 후 확정.
- scorecard 점수 가중치.
- LSP 프로토콜 세부(진단 push/pull, code action).
- 모노레포 우선순위의 근접도 외 엣지케이스.
- en/ko 외 i18n 확장 시점.
- LLM provider 추상화(Anthropic/OpenAI/로컬) 인터페이스 세부.

---

### 변경 이력
- **v0.3 (2026-05-31):** 최초 동결. Instruction 개명 전 문서 적용, Diagnostic/SARIF 모델 확정, settingKV 온톨로지·modality 사전·tree-sitter 언어셋 동결, NLI fine-tune 단계적 채택 결정.
