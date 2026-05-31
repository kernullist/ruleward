# ail — agent instruction lint

AGENTS.md / CLAUDE.md / Cursor rules 등 **AI 에이전트 룰파일**의 충돌·중복·과대화·코드드리프트를 분석하고 수정을 제안하는 린터 & 검증기.

> **상태: Phase 0 완료 + Phase 1 일부 — IR 파서 + 결정론 Check(충돌·중복·과대화·드리프트·코드드리프트) + SARIF 2.1.0 + GitHub Actions.** (vitest 59개 통과)
> 코드 드리프트(Code→Rule): `@deprecated`·`[Obsolete]`·`#[deprecated]` 등 폐기 마커를 **주석/어노테이션 맥락에서** 스캔해 **가드 룰 누락**(헤드라인)을 탐지.
> tree-sitter 정밀 인덱스는 보류 — web-tree-sitter 0.26 ↔ tree-sitter-wasms 0.1.13 ABI 불일치(현재는 정규식 스캐너로 대체). 다음: 로컬 ML(임베딩 중복·NLI 충돌).
> 설계 배경: [DESIGN.md](DESIGN.md) · [docs/DEEP-DIVE.md](docs/DEEP-DIVE.md) · [docs/FROZEN-v0.3.md](docs/FROZEN-v0.3.md)(구현 계약).

## 빠른 시작

```bash
npm install
npm test                                       # vitest (59 tests)
npm run typecheck                              # tsc --noEmit
npx tsx src/cli.ts parse test/fixtures         # 룰파일/디렉토리 → Instruction IR 요약
npx tsx src/cli.ts check test/fixtures         # 5개 엔진 진단 (pretty)
npx tsx src/cli.ts check test/fixtures-drift   # 코드 드리프트(missing-guard-rule) 데모
npx tsx src/cli.ts check . --format sarif --error-on drift/stale-command   # SARIF + CI 게이팅
npx tsx src/cli.ts discover .                  # 룰파일 탐색만
```

`parse` 출력 예: `L7 SHOULD/style/atomic 5tok kv=style.indent=tab` — 라인·directive·category·atomicity·토큰·settingKV·codeReferents를 한 줄로.

## 무엇이 구현됐나 (Phase 0)

`룰파일 → 파싱 → Instruction[]`(Instruction IR) → 4개 Check Engine → `Diagnostic[]` → SARIF/pretty.

```
src/
  types.ts                 Instruction IR / Diagnostic 타입 (FROZEN §2)
  tokens.ts                토큰 카운트 (gpt-tokenizer)
  discovery/discover.ts    멀티포맷 탐색 + RuleFile 구성 (AGENTS/CLAUDE/.mdc/copilot/windsurf/cline)
  parse/
    markdown.ts            remark/mdast → 룰 후보 블록 (인라인 코드 백틱 보존)
    atomize.ts             블록 → 원자 클로즈 분할(복문 분리)
    parseFile.ts           오케스트레이터: 블록 → Instruction[]
  extract/
    modality.ts            directive/polarity 추출 (Modality 사전 v1, en/ko · FROZEN §4)
    settingkv.ts           settingKV 온톨로지 v1 (24키 · FROZEN §3)
    referents.ts           코드 referent 추출 (신뢰도 부착, 백틱 우선)
    scope.ts               globs/loading/dirBoundary 유도
    category.ts            Galster taxonomy 분류
  diagnostics.ts           Diagnostic/Severity/fingerprint (FROZEN §2)
  analyze/
    configFacts.ts         package.json/tsconfig/prettier/.editorconfig → fact
    context.ts             AnalysisContext (instructions + config + exists)
    scopeRel.ts            스코프 부분순서 (오버라이드 vs 버그 판정)
    run.ts                 analyzePath: discover→parse→buildContext→runChecks
    engines/{conflict,duplication,bloat,drift,codedrift}.ts   5개 Check 엔진
  codeindex/scan.ts        deprecation 디텍터 (Code→Rule 드리프트 입력, 정규식 v1)
  report/
    sarif.ts               Diagnostic[] → SARIF 2.1.0
    pretty.ts              CLI 텍스트 출력
  index.ts                 공개 API (parseRoot, analyzePath, toSarif 등)
  cli.ts                   ail parse / discover / check (commander)
```

## Checks (결정론, Phase 0–1)

| Engine | Check | 심각도 | 설명 |
|---|---|---|---|
| conflict | `setting-collision` | error | 같은 스코프에서 settingKV 값 충돌 (탭 vs 스페이스 등) |
| conflict | `scoped-override` | info | 더 구체적 스코프가 상위를 오버라이드 (의도 확인) |
| conflict | `prohibit-vs-require` | error | 같은 import 대상이 금지+권장 동시 지정 |
| duplication | `redundant-with-config` | warning | package.json/tsconfig/prettier가 이미 강제하는 룰 |
| duplication | `rule-rule` | warning/info | 룰 간 완전(동일)/근접(Jaccard≥0.85) 중복 |
| bloat | `token-budget` | warning | always-on 토큰 예산 초과 |
| bloat | `vague` | info | "clean code" 류 모호 룰 |
| drift | `dangling-path` | warning | 존재하지 않는 경로 참조 |
| drift | `stale-command` | error | package.json scripts에 없는 명령 |
| drift | `stale-dependency` | warning | 미설치 프레임워크 명시 |
| drift | `broken-alias` | warning | tsconfig paths/의존성에 없는 별칭 |
| drift | `missing-guard-rule` | info | 코드의 `@deprecated` 심볼을 막는 룰이 없음 (+ 룰 초안 제안) — **헤드라인** |
| drift | `deprecated-symbol-recommended` | warning | 룰이 deprecated 심볼 사용을 권장/허용 |

`ail check <path> --format sarif|json|pretty --max-level error|warning|info [--error-on <check/engine,…>] [--no-code-scan]` — `--max-level` 이상이면 exit 1. `--error-on`으로 특정 check/engine만 error 승격(예: CI에서 `drift/stale-command`만 실패 처리). 기본은 결정론 검사만 error(FP 억제).

**GitHub Actions:** [`.github/workflows/ci.yml`](.github/workflows/ci.yml)(typecheck+test), [`.github/workflows/lint-rules.yml`](.github/workflows/lint-rules.yml)(룰 린트 → SARIF를 code scanning에 업로드; 다른 레포용 템플릿).

## Instruction IR (요약)

각 Instruction: `id, source{file,line,headingPath}, raw, normalized, directive(MUST/…/INFO), polarity, atomicity(atomic/compound/narrative), fromCompound, scope{globs,loading,dirBoundary}, category, settingKV{key,value,confType}|null, codeReferents[{kind,value,confidence}], tokens`. 전체 정의는 [`src/types.ts`](src/types.ts).

## 알려진 v1 한계 (의도된 것)

- Instruction당 settingKV는 **1개**만 추출 (예: "2-space indentation"은 `style.indent=space`로 매칭되고 `indentSize=2`는 가려짐).
- 선언형으로 쓰인 설정 문장("Maximum line length 100 characters.")은 modality 트리거가 없어 `INFO/narrative`로 분류될 수 있음 — settingKV는 여전히 추출됨.
- `async/await`처럼 `/`를 포함한 백틱 토큰은 `path`로 분류될 수 있음.
- 명령형 동사 사전·ko 종결어미 탐지는 휴리스틱(평가 하니스로 캘리브레이션 예정).

이 한계들은 후속 단계(다중 settingKV 허용·directive 보정·로컬 ML 계층)에서 개선 예정.
