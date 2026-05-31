# cclint Teardown — 실제 OSS 코드로 설계 검증

> 우리 설계([DESIGN.md](../DESIGN.md) / [DEEP-DIVE.md](DEEP-DIVE.md))를 현실 코드와 대조한다.
> 두 개의 `cclint` 구현을 클론·정독했다:
> - **felix** — [`@felixgeelhaar/cclint`](https://github.com/felixgeelhaar/cclint) **v0.14.0** (헥사고날, MCP+Action+plugin, 가장 성숙)
> - **carl** — [`@carlrannaberg/cclint`](https://github.com/carlrannaberg/cclint) **v0.2.10** (파일타입별 린터 + SDK)
>
> 결론 먼저: **둘 다 "코드를 텍스트로 읽고 정규식으로 검사하는 구조 린터"다.** 우리가 차별화하려는
> 세 축(① 진짜 Markdown AST 기반 IR, ② 룰 간 의미 분석, ③ 룰↔실제 코드 드리프트)은 **둘 다 비어 있다.**
> 동시에, 둘은 우리가 **그대로 베껴야 할 엔지니어링 패턴**(구조화 Violation, zod frontmatter, MCP/Action 표면, 병렬 처리)을 검증해 준다.

---

## 1. 아키텍처 한눈에

### felix (헥사고날, ESLint식 룰 엔진)
```
domain/        Rule(인터페이스) · RulesEngine · Violation · Severity · Location · ContextFile · LintingResult
rules/         FileSizeRule, FormatRule, StructureRule, ContentRule, ImportResolutionRule,
               ImportSyntaxRule, MonorepoHierarchyRule, CodeBlockRule, CommandSafetyRule, …
infrastructure/ FileReader, ConfigLoader, GitDiffProvider, FileWatcher(chokidar), HookManager,
               PluginLoader, security/PluginSandbox, RuleRegistry, AutoFixer, Scaffolder, ProjectDetector
cli/ mcp/ action/   3개 어댑터 표면: CLI(commander) · MCP 서버 · GitHub Action(@actions/core)
```
- `Rule` 인터페이스(`domain/Rule.ts`)는 **단 3멤버**:
  ```ts
  interface Rule { readonly id: string; readonly description: string; lint(file: ContextFile): Violation[]; }
  ```
- `RulesEngine`(`domain/RulesEngine.ts`)는 `Map<string, Rule>`에 룰을 담고 **각 룰을 단일 파일에 순차 실행**해 `LintingResult`로 집계. **cross-rule·cross-file 분석 없음.**
- `Violation`(`domain/Violation.ts`): `{ ruleId, message, severity, location }` + `equals()`(중복 제거용). **구조화돼 있음.**
- `Severity`(`domain/Severity.ts`): value-object, `level`(info=0/warning=1/error=2) + `isAtLeast()`(게이팅).
- `ContextFile`(`domain/ContextFile.ts`): **`{ path, content, lines[] }`가 전부.** `hasSection()`은 정규식. **AST 없음.**

### carl (파일타입별 린터 + SDK)
```
linters/   base(BaseLinterImpl) · claude-md · agents · commands · settings · symlink   (파일종류마다 1개)
reporters/ console · json · markdown        ← SARIF 없음
lib/       core · config · schemas(zod) · sdk · project-detection · utils
types/     LintResult · LintOptions · CclintConfig · …
```
- `LintResult`(`types/index.ts`): **`{ file, valid, errors: string[], warnings: string[], suggestions: string[], missingFields: string[] }`.**
  → **치명적 약점: 진단이 그냥 문자열 배열.** ruleId도, line/column 위치도 없다. SARIF·정밀 fix가 원천적으로 어렵다.
- `BaseLinterImpl`(`linters/base.ts`): `gray-matter`로 frontmatter 파싱 → **zod 스키마 검증** + 유저 `customValidation` 훅. 파일 발견(glob/picomatch) + **병렬 처리(concurrency=10)** + 심링크 탈출 방지.
- `claude-md.ts`: 구조 분석이 전부 `content.match(/.../)`·`content.includes()`·heading 부분문자열. 예) `checkCommonPatterns`는 `[{pattern:/test/i},…].filter(p=>p.test(content))`. **40k 문자 상한 하드코딩**(AgentLint과 동일 수치), "500자 미만이면 짧음" 경고. 전부 휴리스틱.

---

## 2. 결정적 발견 — 둘 다 *안* 하는 것 (= 우리 공백)

| 능력 | felix | carl | 근거 |
|---|---|---|---|
| 진짜 Markdown **AST** | ✗ (lines[]+regex) | ✗ (split('\n')+regex) | `ContextFile`, `claude-md.analyzeStructure` |
| **토크나이저**(정확 토큰) | ✗ (문자수 근사) | ✗ (`content.length`) | deps에 tiktoken류 전무; carl은 40k *문자* |
| **룰 간 충돌/중복** 분석 | ✗ | ✗ | `RulesEngine`는 룰을 독립 실행; carl은 파일별 |
| **룰 ↔ 소스코드** 드리프트 | ✗ | ✗ | 아래 ★ |
| **SARIF** 출력 | ✗ (Action은 inline annotation) | ✗ (console/json/md) | grep `sarif` → 0건 |
| 구조화 진단(id+위치) | **✓** | ✗ (string[]) | `Violation` vs `LintResult` |
| 의미/ML/LLM 계층 | ✗ | ✗ | ML 의존성 전무 |

★ **"drift"에 대한 결정적 오해 해소:** felix는 마케팅에서 *"Catch CLAUDE.md drift"*를 내세우고 `ImportResolutionRule`·`GitDiffProvider`를 갖췄다. 하지만 코드를 읽어보면 `ImportResolutionRule`은 **CLAUDE.md의 `@import` 링크가 존재하는 파일로 해석되는지 + 순환참조 + 5-hop 깊이**만 검사한다(`src/rules/ImportResolutionRule.ts`). **실제 소스코드의 심볼/함수/폐기물은 전혀 보지 않는다.** 즉 felix의 "drift" = *지시문 파일들 사이의 링크 무결성*이고, 우리의 코드-드리프트 = *지시문 ↔ 실제 코드*다. **겹치지 않는다 → 우리 헤드라인 기능은 진짜로 novel.**

---

## 3. 차용(BORROW) — 검증된 패턴, 그대로 가져온다

1. **ESLint식 Check 인터페이스** (felix `Rule`): `{ id, description, run(...) → Diagnostic[] }`의 단순·플러그형 모양. **단, 이름 충돌 주의(§5-A).**
2. **구조화 `Violation` + `Severity` value-object** (felix). `{ checkId, message, severity, location, ... }` + `equals()`/`isAtLeast()`. carl의 `string[]`은 **안티패턴으로 회피**. → 이게 SARIF 매핑의 토대.
3. **zod 기반 frontmatter 검증 + 유저 `customValidation`/schema extend·override** (carl `base.ts`/`types`). `.mdc`·agent·command frontmatter 검증에 직수입.
4. **`gray-matter`** frontmatter 파서 (carl). 우리 IR 프론트엔드의 frontmatter 단계로 채택.
5. **ProjectDetector / `ProjectInfo`** (carl `project-detection`): git·`.claude`·패키지매니저 감지. → 우리 **config-fact 추출**(중복 엔진의 visibility check)과 자연스럽게 합류.
6. **병렬 파일 처리 + concurrency 캡** (carl `base.lintFiles`).
7. **3개 어댑터 표면**: CLI(commander) · **MCP 서버**(`@modelcontextprotocol/sdk`) · GitHub Action (felix). 특히 **MCP 서버는 에이전트가 자기 룰파일을 셀프-린트**하게 해주는 강력한 표면 → 반드시 채택.
8. **FileWatcher(chokidar)** 워치 모드 (felix) + `failOn` 심각도 게이팅 (carl) → 우리 신뢰도-계층 게이팅과 결합.
9. **SDK/프로그래매틱 API** (carl `sdk.ts`) — 임베딩용 공개 API.
10. **엔지니어링 규율**: ADR 디렉토리 + **mutation testing(stryker)** (felix). 품질 신호로 모방.
11. **헥사고날 분리** (felix ADR-003): domain(Check/Diagnostic/Engine) ↔ infrastructure(파일/Git/Plugin/Index) ↔ adapters(cli/mcp/action). 멀티표면 목표에 맞다.

## 4. 차별화(DIFFERENTIATE) — 우리가 메우는 공백

| 우리 차별점 | 왜 (그들의 한계) | 우리 설계 매핑 |
|---|---|---|
| **진짜 mdast/remark AST → Instruction IR** | 둘 다 regex/line → 위치 부정확·중첩 리스트 취약·코드펜스 수동추적 | DEEP-DIVE §A |
| **룰 간 의미 분석(충돌·중복)** | 둘 다 체크를 독립 실행, 룰끼리 비교 안 함 | DEEP-DIVE §B + 중복 엔진 |
| **룰 ↔ 소스코드 드리프트(양방향)** | felix "drift"는 `@import` 링크뿐; 폐기심볼/없는심볼 미검출 | DEEP-DIVE §C (deprecation 디텍터, Code→Rule) |
| **SARIF 출력** | 둘 다 없음 → code-scanning/IDE 미연동 | 아래 §6 |
| **정확 토큰 예산** | 문자수 근사 | tokenizer 채택 |
| **멀티포맷 통합 IR** | Claude 중심(CLAUDE.md/.claude); AGENTS.md 중첩·`.mdc` globs·copilot `applyTo` 통합 IR 없음 | Discovery + scope 모델 |
| **신뢰도-계층 심각도** | 단일 severity, ML/LLM 없음 | DESIGN §8 |

---

## 5. 설계에 즉시 반영할 변경 (action items)

**A. 용어 충돌 해소 (코드 읽다 발견한 실질 개선).**
cclint에서 **"Rule" = 린트 체크**(ESLint식). 우리 설계에서 **"Rule" = 파일에서 추출한 원자 지시문**. 같은 단어가 정반대를 가리켜 혼선 위험.
→ **확정:** 추출 단위를 **`Instruction`(또는 `Directive`)** 으로, 분석 모듈을 **`Check`**(4개 **`Engine`**으로 묶음)로 명명. "Rule IR"는 **"Instruction IR"**로 개칭. (cclint 사용자가 우리 도구로 넘어올 때 멘탈모델 충돌 방지.)

**B. 진단 모델은 felix `Violation` 모양을 채택**(carl `string[]` 회피): `{ checkId, engine, message, severity, confidence, location, relatedLocations[], fix? }`. `equals()`/지문(fingerprint)으로 런-간 중복 억제.

**C. frontmatter는 carl 방식**(`gray-matter` + zod + customValidation)을 그대로.

**D. 표면 3종(CLI/MCP/Action) + 워치**를 felix처럼 1급 목표로. **MCP 서버 우선순위 상향**(에이전트 셀프-린트 루프).

**E. SARIF를 1차 출력 포맷으로 못박기**(둘 다 없는 차별점). §6.

**F. config-fact 추출을 carl `ProjectDetector`에서 출발**해 확장(package.json/tsconfig/eslintrc/prettier/editorconfig).

---

## 6. SARIF 매핑 스케치 (우리만의 출력 — 둘 다 없음)

우리 `Diagnostic` → **SARIF 2.1.0** `result`로 매핑. 특히 **cross-entity 발견**(충돌/중복은 *두 룰*, 드리프트는 *코드 위치*)을 `relatedLocations`로 표현 — 단일 파일·단일 위치만 다루는 cclint류엔 필요 없던 기능이라 그들이 안 가진 이유이기도 하다.

```jsonc
{
 "version": "2.1.0",
 "runs": [{
   "tool": { "driver": {
     "name": "ruleward", "informationUri": "…",
     "rules": [   // 우리 Check 카탈로그
       { "id": "conflict/setting-collision", "name": "SettingCollision",
         "shortDescription": { "text": "동일 설정 키가 상충하는 값으로 지정됨" },
         "defaultConfiguration": { "level": "error" }, "helpUri": "…/checks/setting-collision" },
       { "id": "drift/missing-guard-rule", "name": "MissingGuardRule",
         "defaultConfiguration": { "level": "note" } }
     ] } },
   "results": [
     // 충돌: 두 룰을 가리킴
     { "ruleId": "conflict/setting-collision", "level": "error",
       "message": { "text": "style.indent이 tab(여기) vs space(저기)로 충돌" },
       "locations":        [ { "physicalLocation": { "artifactLocation": { "uri": "AGENTS.md" },
                                                      "region": { "startLine": 9, "startColumn": 3 } } } ],
       "relatedLocations": [ { "physicalLocation": { "artifactLocation": { "uri": ".cursor/rules/style.mdc" },
                                                      "region": { "startLine": 4 } },
                              "message": { "text": "상충하는 다른 룰" } } ],
       "partialFingerprints": { "ruleward/v1": "<stable-hash>" },   // 런-간 안정 ID(noise 억제)
       "properties": { "confidence": 0.99, "engine": "conflict" } },

     // 드리프트(Code→Rule): 코드의 폐기 심볼을 relatedLocation으로
     { "ruleId": "drift/missing-guard-rule", "level": "note",
       "message": { "text": "`OldClient`가 코드에서 deprecated(대체: `NewClient`)인데 이를 막는 룰이 없음" },
       "locations":        [ { "physicalLocation": { "artifactLocation": { "uri": "AGENTS.md" } } } ],
       "relatedLocations": [ { "physicalLocation": { "artifactLocation": { "uri": "src/legacy/client.ts" },
                                                      "region": { "startLine": 12 } },
                              "message": { "text": "@deprecated 선언 위치" } } ],
       "fixes": [ { "description": { "text": "가드 룰 추가" },
                    "artifactChanges": [ { "artifactLocation": { "uri": "AGENTS.md" },
                                           "replacements": [ { "deletedRegion": { "startLine": 30 },
                                             "insertedContent": { "text": "- `OldClient` 사용 금지; `NewClient` 사용." } } ] } ] } ],
       "properties": { "confidence": 0.5, "engine": "drift" } }
   ]
 }]
}
```
매핑 규칙:
- `severity → level`: error→`error`, warning→`warning`, info/suggestion→`note`. (SARIF엔 info 없음 → note.)
- `confidence → properties.confidence` + **게이팅**: `--max-level`로 CI 실패 기준 제어(결정론만 error 승격).
- `fix → fixes[].artifactChanges[].replacements` (auto 등급만 채워 IDE/CI에서 1-click 적용 가능).
- **배포**: `github/codeql-action/upload-sarif`로 업로드 → Security 탭·PR 주석·추세 누적. felix의 휘발성 inline annotation보다 강함.

---

## 7. 한 줄 결론

cclint 두 구현은 **"구조 린터"의 좋은 레퍼런스 구현**이다. 진단 모델(felix `Violation`)·frontmatter 검증(carl zod)·MCP/Action 표면·병렬 처리는 **베끼고**, AST 부재·토큰 근사·룰 독립 실행·코드 무지·SARIF 부재는 **정확히 우리가 메울 자리**다. 설계의 세 차별축(IR/의미분석/코드드리프트)이 현실 코드 대조로 **검증되었다.**

### 후속 반영
- DESIGN/DEEP-DIVE의 "Rule" → "Instruction" 개명 반영(§5-A).
- 출력 포맷 절에 SARIF 매핑(§6) 정식 편입.
- 차용 패턴(zod frontmatter, MCP 서버, ProjectDetector)을 구현 백로그에 추가.
