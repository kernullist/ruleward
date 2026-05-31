# Deep-Dive 기술 스펙 (v0.3)

> **용어(v0.3):** 추출 단위 = **Instruction**, IR = **Instruction IR**, 분석 모듈 = **Check**(4 **Engine**). 아래 의사코드의 변수 `rule`/`inst`는 모두 Instruction을 가리킨다. 전체 용어표 → [DESIGN.md 용어 규약](../DESIGN.md#용어-규약-v03-확정), 동결 계약 → [FROZEN-v0.3.md](FROZEN-v0.3.md).
>
> [DESIGN.md](../DESIGN.md)의 후속. 모든 엔진이 의존하는 **Instruction IR**를 형식적으로 확정하고,
> 가장 어렵고 불확실한 두 엔진(**충돌·드리프트**)의 실제 알고리즘과 **평가 하니스**를 못박는다.
>
> 범위 결정: 여기서는 *기초(IR) + 하드 엔진 2개 + 평가*를 깊게 판다.
> 중복/과대화 엔진은 IR 속성 위의 비교적 단순한 질의라 §A의 IR 확정으로 대부분 규정된다.

## 목차
- [A. Instruction IR 형식 스펙 + 추출 알고리즘](#a-instruction-ir-형식-스펙--추출-알고리즘)
- [B. 충돌 엔진 상세 알고리즘](#b-충돌-엔진-상세-알고리즘)
- [C. 드리프트 엔진 상세 알고리즘](#c-드리프트-엔진-상세-알고리즘)
- [D. 평가 하니스](#d-평가-하니스)

---

## A. Instruction IR 형식 스펙 + 추출 알고리즘

파싱 파이프라인: `Markdown AST → 블록 분할 → 원자화 → 필드 추출`. 각 필드의 추출은 **결정론 우선, 모델은 폴백**.

### A.1 블록 분할 & 원자화 (atomicity)

입력 Markdown AST에서 "룰 후보 블록"을 뽑는다: 리스트 아이템, 단락, heading 직속 문장.

```
classify_block(text) -> {atomic | compound | narrative}
  directive = detect_directive(text)            # A.2
  if directive == INFO and not is_imperative(text):
      return narrative                          # 설명 산문 → 룰 분석 제외(토큰엔 계상)
  clauses = split_clauses(text)                 # 아래 분할 규칙
  return atomic if len(clauses) == 1 else compound
```

**clause 분할 규칙(언어별 사전):**
- 등위접속(`, and` / `; ` / `또한` / `그리고`)으로 연결된 **독립 명령**을 분리.
- 단, "do X **and** Y"에서 X·Y가 같은 동사의 목적어면 분리하지 않음(의존 구문 분석 또는 휴리스틱: 두 번째 절에 동사 부재 → 분리 안 함).
- `compound`는 분할 제안(`split-compound-rule` 진단)을 만들되, 분석 시엔 내부 clause 각각을 가상 atomic으로 펼쳐 평가.

### A.2 directive / polarity 추출 (RFC2119 + 명령문)

다국어 **modality 사전**(en/ko 우선)으로 키워드 → 등급 매핑:

| directive | 영어 트리거 | 한국어 트리거 |
|---|---|---|
| `MUST` | must, always, required, shall, never(부정문 안) | 반드시, 항상, 필수, 무조건 |
| `MUST_NOT` | must not, never, do not, forbidden, disallowed | 하지 마라, 금지, 절대 ~말 것 |
| `SHOULD` | should, prefer, recommended | 권장, ~하는 게 좋다, 지향 |
| `SHOULD_NOT` | should not, avoid, discouraged | 지양, 피하라 |
| `MAY` | may, can, optional | ~해도 된다, 선택적 |
| `INFO` | (트리거 없음 + 서술문) | — |

```
detect_directive(text):
  neg = has_negation(text)                       # not, never, 없이, 말 것 …
  lvl = lexicon_lookup(text)                     # 위 표, 최강 매칭
  if lvl is None:
     return MUST? no → if is_imperative(text): SHOULD else INFO
  return combine(lvl, neg)                        # never+부정문 → MUST_NOT 등 정규화

polarity:
  MUST/SHOULD/MAY(긍정)            -> requirement (MAY는 약한 requirement)
  MUST_NOT/SHOULD_NOT             -> prohibition
  prefer/avoid 류                  -> preference
  INFO                            -> statement
```

`is_imperative`: 문장이 동사원형으로 시작 + 주어 부재(영어) / 종결어미 명령형(한국어). 경량 POS(예: `wink-pos-tagger`) 또는 규칙 기반.

### A.3 settingKV 추출 — 충돌·중복의 최고신뢰 입력

"키-값으로 환원 가능한 룰"을 **정규 온톨로지**로 매핑. 이게 충돌 Tier-0의 연료다.

**정규 키 온톨로지(발췌, 확장 가능):**

| canonical key | 값 도메인 | 매칭 패턴 예 |
|---|---|---|
| `style.indent` | `tab` \| `space` | "use tabs", "indent with spaces", "탭 사용" |
| `style.indentSize` | int | "2-space indent", "4칸 들여쓰기" |
| `style.quotes` | `single` \| `double` | "single quotes", "큰따옴표" |
| `style.semicolons` | `required` \| `forbidden` | "no semicolons", "세미콜론 필수" |
| `style.lineLength` | int | "max 100 chars", "120자" |
| `imports.restricted` | path/glob 집합 | "don't import from `X`", "X import 금지" |
| `imports.preferred` | path/glob | "import from `@core`" |
| `naming.case` | `camel`\|`snake`\|`pascal`\|`kebab` | "camelCase for vars" |
| `testing.framework` | string | "use jest", "pytest로 테스트" |
| `lang.version` | string | "target ES2022", "Python 3.11+" |
| `commit.format` | string | "conventional commits" |

```
extract_settingKV(rule):
  for (key, matcher) in ONTOLOGY:
     m = matcher(rule.normalized, rule.codeReferents)
     if m: return {key, value: normalize_value(key, m), span}
  return null     # 자유서술 룰은 settingKV 없음 → NLI/LLM 경로로
```

정규화는 동의어 흡수: `tabs|tab|tabulation → tab`, `2|two|두 → 2`. 값 도메인이 닫힌 키는 충돌 판정이 **결정론·신뢰도 0.99**.

### A.4 scope 유도

- `.mdc`: frontmatter `globs`, `alwaysApply` 직접 사용.
- `AGENTS.md`(중첩): 파일이 위치한 디렉토리 = `dirBoundary`, `globs = ["<dir>/**"]`, `loading = always`(루트면 전역).
- `CLAUDE.md`: 프로젝트=always 전역, `~/.claude`=유저전역, `@import` 대상은 부모 scope 상속.
- `copilot *.instructions.md`: frontmatter `applyTo` glob.
- `loading` 정규화: `always | auto-attached(글롭 매칭 시) | agent-requested(description 기반 호출) | manual`.

**스코프 부분순서(⊑)**: A ⊑ B ("A가 더 구체적") ⟺ A.globs로 매칭되는 파일집합 ⊆ B.globs. glob 포함관계는 정밀 계산 대신 **샘플 경로 집합 + glob 매칭**으로 근사(완전 포함은 비결정적이므로 보수적으로 "겹침/포함/무관" 3치 판정).

### A.5 category 분류

Galster taxonomy(`style|quality|architecture|build|test|security|tooling|context|process`)로:
1. 키워드 사전 1차.
2. 모호하면 임베딩 nearest-centroid(각 카테고리 시드 문장 centroid).
3. LLM 폴백(opt-in). 충돌 후보 클러스터링에 쓰이므로 정밀도보다 *일관성*이 중요.

### A.6 enforceability — 3-Question Audit 코드화

```
configVisible  = matches_config_fact(rule, configFacts)     # §C.2 fact DB와 공유
toolEnforceable = TOOL_MAP.lookup(rule.settingKV?.key || rule.pattern)  # 예: style.semicolons → eslint:semi
decisionImpact =
   high  if directive in {MUST, MUST_NOT} and rule.codeReferents.high.exists
   med   if directive in {SHOULD, SHOULD_NOT} or has any referent
   none  if narrative or (specificityScore == 0 and no referent)
```
- `configVisible=true` → 중복 엔진 `redundant-with-config`.
- `toolEnforceable!=null` → 과대화 엔진 `move-to-tool`(+ 설정 스니펫).
- `decisionImpact=none` → 과대화 `low-value-rule`.

### A.7 worked example

입력(`.cursor/rules/imports.mdc`):
```mdc
---
globs: ["src/**/*.ts"]
alwaysApply: false
---
- Never import from `src/legacy/*`; use `@core/*` instead.
- Write clean, maintainable code.
```
산출 IR(요약):
```jsonc
[
 { "directive":"MUST_NOT","polarity":"prohibition","atomicity":"compound",
   "settingKV":{"key":"imports.restricted","value":"src/legacy/*"},
   "codeReferents":[{"kind":"path","value":"src/legacy/*","confidence":0.95},
                    {"kind":"path","value":"@core/*","confidence":0.90}],
   "scope":{"globs":["src/**/*.ts"],"loading":"auto-attached"},
   "category":"architecture","enforceability":{"toolEnforceable":"eslint(no-restricted-imports)","decisionImpact":"high"} },
 { "directive":"SHOULD","polarity":"preference","atomicity":"atomic",
   "settingKV":null,"codeReferents":[],
   "category":"quality","enforceability":{"decisionImpact":"none"},  // ← 과대화: low-value
   "_note":"specificity 0 → '클린 코드' 모호 룰" }
]
```
첫 룰은 compound(`split` 제안) + `toolEnforceable`(eslint로 이동 가능) + 드리프트 입력(`src/legacy`, `@core` 경로 검증). 둘째 룰은 과대화 플래그.

---

## B. 충돌 엔진 상세 알고리즘

### B.1 후보 생성 (O(n²) 폭발 방지)

```
candidates = []
for cluster in cluster_by(category):                  # 같은 토픽끼리만
   for (a,b) in pairs(cluster):
      if scope_relation(a,b) in {overlap, contains} and
         cos(a.emb, b.emb) >= 0.55:                    # 같은 주제일 때만
         candidates.append((a,b))
```
수백 룰 규모에서 클러스터+임베딩 게이트로 LLM/NLI 호출을 통상 1~2자리수로 축소.

### B.2 Tier-0 — symbolic settingKV 충돌 (결정론)

```
group rules by settingKV.key
for key, rs in groups:
   vals = distinct(r.settingKV.value for r in rs)
   if domain(key) is closed and len(vals) > 1:
       emit CONFLICT(kind="setting-collision", key, rules=rs, conf=0.99, sev=error)
   if key in {imports.restricted, imports.preferred}:
       # prohibition(restricted ∋ p) vs requirement(preferred ∋ p) 교차 검사
       if overlap(restricted_set, preferred_set):
           emit CONFLICT(kind="prohibit-vs-require", conf=0.97, sev=error)
```
*예:* `style.indent=tab` 룰과 `style.indent=space` 룰 → 즉시 error. **NLI 불필요.**

### B.3 Tier-A — NLI, "명령문 off-distribution" 문제 해결

NLI 모델(`nli-deberta-v3-base` 등)은 **서술문(premise→hypothesis)** 학습이라 명령문에 약하다. 해결책: **directive→서술 정규화(declarativize)** 후 투입.

```
declarativize(rule):
  s = rule.normalized (+ scope를 절로 부착: "In <globs>, ...")
  match rule.directive:
    MUST(x)     -> "<x> is required."
    MUST_NOT(x) -> "<x> is forbidden."
    SHOULD(x)   -> "<x> is recommended."
    SHOULD_NOT  -> "<x> is discouraged."
  return s

nli_conflict(a,b):
  da, db = declarativize(a), declarativize(b)
  c1 = NLI(da, db).contradiction; c2 = NLI(db, da).contradiction   # 대칭화
  score = max(c1, c2)
  return score
```
- `score ≥ 0.8` → `warning`(conf≈score). `0.4~0.8` → Tier-B로 에스컬레이션. `<0.4` → drop.
- **모달 충돌**(절대 vs 조건부)은 NLI가 약함 → 보조 규칙: 한쪽 `MUST_NOT(x)` ∧ 다른쪽 `MAY/SHOULD(x when cond)` ∧ 동일 settingKV/referent → 별도 플래그 `modal-conflict`.
- *대안/강화*: SNLI/MNLI 위에 **합성 명령문-쌍 데이터**(우리 settingKV 온톨로지에서 자동생성: "use tabs"/"use spaces" 류 수천 쌍)로 소량 fine-tune → 명령문 도메인 적응. v0.2 권장.

### B.4 Tier-B — LLM-judge (opt-in, 애매 구간만)

구조화 출력으로 호출:
```json
{ "conflict": true, "type": "direct|modal|scope|none",
  "winner_hint": "ruleA|ruleB|ambiguous",
  "explanation": "...", "confidence": 0.0 }
```
캐시(룰쌍 해시), `suggestion` 심각도. 대량 호출 방지를 위해 Tier-A 애매쌍만.

### B.5 오버라이드 vs 버그 판정 (우선순위 모델)

```
decide(a, b):                       # 이미 충돌로 판정된 쌍
   rel = scope_relation(a, b)
   if rel == contains:              # 한쪽이 더 구체적
       specific, general = more_specific(a,b)
       return INFO("scoped-override",
                   msg=f"{specific.file}이 {general.file}을 의도적으로 오버라이드(추정)")
   if same_file_or_same_scope(a, b):
       return ERROR/WARNING("true-conflict")     # 같은 권위면 진짜 버그
   if rel == overlap (부분 교집합):
       return WARNING("partial-scope-conflict")  # 교집합 파일에서 모호
```
중첩 우선순위는 §A.4의 `dirBoundary` 근접도로 보강(편집파일에 가까울수록 우선).

### B.6 출력 스키마
```jsonc
{ "engine":"conflict","check":"setting-collision","severity":"error","confidence":0.99,
  "rules":["mdc::imports::L4","AGENTS.md::Style::L9"],
  "message":"style.indent이 tab(여기)와 space(저기)로 충돌",
  "fix":{"kind":"manual","options":["tab로 통일","space로 통일"]} }
```

---

## C. 드리프트 엔진 상세 알고리즘

### C.1 referent 추출 문법 (신뢰도 부착)

```
classes (높은 신뢰도순):
  CODE_SPAN   `...` 백틱 스팬                                    conf 0.9
  PATH_LIKE   r'(\./)?([\w@.-]+/)+[\w@.*-]+(\.\w+)?'             conf 0.85
  COMMAND     r'(npm|yarn|pnpm) run \w+ | make \w+ | cargo \w+' conf 0.9
  PACKAGE     백틱/인용 토큰이 매니페스트 deps에 존재             conf 0.95(존재 시)
  SYMBOL_LIKE CamelCase/snake_case/PascalCase (백틱 내부 한정)   conf 0.7
  PROSE_ENTITY  평문 NER("the old client") → LLM 분류            conf ≤0.5
```
- **백틱 밖 SYMBOL_LIKE는 채택 안 함**(영어 단어 오인 방지). "use the Button" → drop.
- 각 referent에 `kind ∈ {path, command, package, symbol, alias, concept}` 부여.

### C.2 코드 인덱스 스키마

```jsonc
{
 "files": Set<path>,
 "symbols": [ {name, kind, file, line, exported:bool,
               deprecated:bool, deprecationNote?, replacement?} ],
 "manifests": { deps:Set, devDeps:Set, scripts:Map, aliases:Map },  // package.json/tsconfig paths/pyproject…
 "configFacts": [ {key, value, source} ]   // §6.2 추출기 — 중복엔진과 공유
}
```
- 빌더 계층: tree-sitter(기본) → SCIP(정밀 opt-in, `exported`/참조 정확) → ctags(폴백).
- `replacement`: deprecation 노트에서 "use X instead" / "→ X" 파싱.

### C.3 Rule→Code 해석 (stale 탐지)

```
resolve(referent):
  switch referent.kind:
    path:    exists = match_any(index.files, referent.value)         # glob 허용
             return DANGLING_PATH if not exists                      [conf high]
    command: name = parse_script(referent.value)
             return STALE_COMMAND if name not in manifests.scripts   [conf high]
    package: return STALE_DEPENDENCY if value not in deps∪devDeps    [conf high]
    alias:   return BROKEN_ALIAS if prefix not in manifests.aliases  [conf high]
    symbol:  hit = index.symbols by name (+scope filter)
             if none: return STALE_SYMBOL                            [conf medium]
             # 이름은 흔할 수 있음 → medium, warning
```
결정론 4종(path/command/package/alias)만 `error` 후보. symbol은 `warning`.

### C.4 deprecation 디텍터 (Code→Rule의 핵심)

언어별 tree-sitter 쿼리로 폐기 심볼 + 노트 추출:

```scheme
;; TypeScript/JS — @deprecated JSDoc 직후 export 함수/클래스
((comment) @doc (#match? @doc "@deprecated")
 . [(export_statement (function_declaration name:(identifier) @name))
    (export_statement (class_declaration name:(type_identifier) @name))]) @decl

;; Python — @deprecated 데코레이터 또는 DeprecationWarning
(decorated_definition (decorator (identifier) @d (#eq? @d "deprecated"))
  definition: (function_definition name:(identifier) @name))
(call function:(identifier) @w (#eq? @w "warn")
  arguments:(argument_list (identifier) @cls (#match? @cls "DeprecationWarning")))

;; Go — // Deprecated: 관례 주석 + 직후 func/type
((comment) @c (#match? @c "Deprecated:")
 . (function_declaration name:(identifier) @name)) @decl

;; Rust
(attribute_item (attribute (identifier) @a (#eq? @a "deprecated"))) @attr

;; Java
(marker_annotation name:(identifier) @a (#eq? @a "Deprecated"))
;; C#  [Obsolete("...")]
(attribute name:(identifier) @a (#eq? @a "Obsolete"))
```
노트/대체안은 주석·인자 문자열에서 정규식으로 추출(`use\s+`([\w.]+)`|→\s*([\w.]+)`).

### C.5 Code→Rule 매칭 (누락/위반 룰) — 헤드라인 기능

```
for sym in index.symbols where sym.deprecated:
   covering = rules where any referent.value ≈ sym.name        # 정확/퍼지(편집거리)/임베딩
   if covering is empty:
       sev = warning if sym.exported else info
       # 부스터: 폐기 심볼이 코드 어딘가에서 여전히 신규 사용되면 sev↑(grep refs)
       if still_referenced(sym): sev = bump(sev)
       emit MISSING_GUARD_RULE(
         symbol=sym, suggestion=draft_rule(sym),    # "X 사용 금지; <replacement> 사용" 초안
         confidence=0.5, severity=sev)
   else:
       # 룰이 있는데 코드가 위반(폐기물 신규 사용)하면 rule-followed 여부 보고
       pass

# 역방향: 룰 "no eval" 인데 코드에 eval 호출 존재
for rule in prohibition_rules with code-pattern:
   if grep(rule.pattern) has hits: emit RULE_VIOLATED_BY_CODE(conf=0.6, warning)
```
- `≈` 매칭: ① 정확 이름 ② 편집거리 ≤2 ③ 임베딩(룰텍스트 vs 심볼명+doc) ≥ τ. 셋 중 하나라도 → "커버됨"(보수적, 누락 FP 억제).
- `draft_rule`: 결정론 템플릿 우선("Do not use `X`; use `<replacement>` instead."), 노트가 자유서술이면 LLM 다듬기(opt-in).

### C.6 신뢰도 종합 & FP 통제

```
confidence = referent_conf × resolution_certainty × index_precision
   index_precision: SCIP 1.0 / tree-sitter 0.85 / ctags 0.7
severity = map(confidence, check_class)        # §8 표
```
- Code→Rule 누락은 **기본 suggestion**, CI 하드실패 금지(`--allow-drift-warn`로만 승격).
- "여전히 사용 중인 폐기물 + 가드 룰 없음"만 예외적으로 `warning` 기본.

---

## D. 평가 하니스

### D.1 코퍼스
- 공개 레포 N(≥200)에서 실제 `AGENTS.md`/`CLAUDE.md`/`.mdc` 수집(라이선스 필터).
- 각 레포의 코드 인덱스도 함께 스냅샷(드리프트 평가용).

### D.2 결함 주입기 (planted faults → ground truth)

| 엔진 | 주입기 | 정답 라벨 |
|---|---|---|
| 충돌 | settingKV 룰 1개 골라 반대값 룰 추가 / directive 부정 생성 | 주입쌍 = conflict |
| 중복 | 룰 복제·패러프레이즈 / 설정 fact를 산문 룰로 재진술 | 해당 룰 = dup |
| 드리프트 R→C | 룰이 참조하는 심볼 rename·파일 삭제·script 제거 | 해당 룰 = stale |
| 드리프트 C→R | 임의 export 심볼에 `@deprecated` 추가 + 커버 룰 없음 보장 | 해당 심볼 = missing-guard |
| 과대화 | 모호 룰("clean code") 삽입 / 설정-강제 룰 삽입 | 해당 룰 = bloat/move-to-tool |

주입은 **AST/IR 레벨**에서 수행해 위치·정답을 정확히 기록.

### D.3 지표
- 엔진별·검사별 **precision / recall / F1**.
- **FP율을 1급 지표**로 별도 추적(특히 `error` 승격 검사).
- **심각도 캘리브레이션**: confidence 임계 스윕 → "결정론 검사만 error로 승격 시 FP=0 유지" 검증(ROC/PR 곡선).
- 회귀 추적: 코퍼스 고정 → 버전별 지표 추세.

### D.4 절차
1. dogfooding: 본 레포 룰파일 + 인기 OSS에 dry-run, 수동 라벨로 baseline.
2. 주입 코퍼스로 자동 평가(CI).
3. 임계·사전 튜닝 후 재측정.

---

## 확정 항목 → [FROZEN-v0.3](FROZEN-v0.3.md)에서 동결 완료 ✅
- ✅ settingKV 온톨로지 v1 키 목록 → [FROZEN §3](FROZEN-v0.3.md) (24키)
- ✅ modality 사전(en/ko) 1차 엔트리 → [FROZEN §4](FROZEN-v0.3.md)
- ✅ NLI fine-tune 데이터 자동생성 스펙(§B.3) 채택 → [FROZEN §5](FROZEN-v0.3.md) (단계적 채택)
- ✅ tree-sitter 1차 언어셋 → [FROZEN §6](FROZEN-v0.3.md) (TS/JS/Py/Go)
- ✅ 경쟁 도구 `cclint` teardown → [cclint-teardown.md](cclint-teardown.md)
