import type { AnalysisContext } from '../context';
import type { Instruction } from '../../types';
import { type Diagnostic, fingerprint } from '../../diagnostics';
import { scopeRelation } from '../scopeRel';
import { declarativize, type NliScorer } from '../../semantic/nli';

/**
 * conflict/nli-contradiction (opt-in 실험 계층) — settingKV로 환원 안 되는 자연어 의미 모순.
 *
 * v2 후보선정(반대극성/공유대상 게이팅): 실코퍼스 검증(docs/nli-finetune.md)에서 느슨한
 * 토픽토큰 게이트가 326건 대부분 FP(상보 단계·무관 쌍·호환 prohibit/require)를 낸 것을
 * 받아, **두 룰이 같은 구체 대상(코드 referent)을 공유할 때만** NLI에 투입한다.
 *   - 같은 대상 + 반대극성("never use `X`" ⟂ "always use `X`") → 구조적 모순 후보(고신뢰).
 *   - 같은 대상 + 값 대립("make `Foo` small" ⟂ "make `Foo` large") → NLI가 판정.
 *   - 다른 대상("`tower run`" vs "`tower-mcp`") → 상보적이므로 애초에 비교하지 않음.
 * referent 없는 순수 산문은 신뢰 가능한 대상이 없어 비교 대상에서 제외(FP 근원).
 * FP 통제: 결정론 Tier-0(settingKV) 중복 회피, info 심각도(결정론 게이트 불변).
 */

const DEFAULT_THRESHOLD = 0.9;
const MAX_RULES = 400; // O(n^2) 폭주 방지 (referent 게이트로 후보가 크게 줄어 상향)
const MIN_REF_CONF = 0.4; // 백틱 유래 referent(개념 0.45 포함). 평문 저신뢰는 제외.

/** 비교용 정규화: 대소문자·괄호·@·따옴표 제거. `@ApiTags()`→apitags, `tower-mcp`→tower-mcp. */
function normRef(v: string): string {
  return v
    .toLowerCase()
    .replace(/\(\s*\)$/, '')
    .replace(/^@/, '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

/** 룰이 제약하는 구체 대상 집합(고신뢰 referent만). 빈 집합이면 비교 제외. */
function subjectsOf(i: Instruction): Set<string> {
  const s = new Set<string>();
  for (const r of i.codeReferents) {
    if (r.confidence < MIN_REF_CONF) continue;
    const n = normRef(r.value);
    if (n.length >= 2) s.add(n);
  }
  return s;
}

function shareSubject(a: Set<string>, b: Set<string>): string | null {
  for (const x of a) if (b.has(x)) return x;
  return null;
}

function nliDiag(a: Instruction, b: Instruction, score: number, subject: string, opposed: boolean): Diagnostic {
  const tag = opposed ? '반대극성' : '값 대립';
  return {
    checkId: 'conflict/nli-contradiction',
    engine: 'conflict',
    severity: 'info',
    confidence: Number(score.toFixed(3)),
    message: `의미적 모순 후보(검토 필요, 대상 \`${subject}\`·${tag}, NLI ${score.toFixed(2)}): "${a.normalized}" ⟂ "${b.normalized}"`,
    location: { file: a.source.file, line: a.source.line },
    related: [{ loc: { file: b.source.file, line: b.source.line }, role: '상충 후보' }],
    fix: { kind: 'manual', description: `\`${subject}\`에 대한 두 룰이 실제로 모순인지 검토 후 하나로 정리` },
    fingerprint: fingerprint(['conflict/nli-contradiction', ...[a.id, b.id].sort()]),
  };
}

/** scorer 주입식(테스트는 mock, 실사용은 getNliScorer 결과). */
export async function checkSemanticConflict(
  ctx: AnalysisContext,
  scorer: NliScorer,
  threshold: number = DEFAULT_THRESHOLD
): Promise<Diagnostic[]> {
  const rules = ctx.instructions
    .filter(
      (i) =>
        i.atomicity !== 'narrative' &&
        i.directive !== 'INFO' && // statement(서술) 제외
        i.directive !== 'MAY' && // 허가("X can be Y")는 모순을 구성하지 않음 — 서술형 문서 산문의 FP 주범
        i.normalized.length > 0 &&
        i.tokens <= 30 && // 긴 산문/다절 문장은 NLI 비교 대상이 아님 (실코퍼스 FP 주범)
        !i.raw.includes('|') // 마크다운 테이블 행 제외 ('required' 같은 트리거어로 오분류되어 들어오는 것 차단)
    )
    .map((i) => ({ i, subjects: subjectsOf(i) }))
    .filter((r) => r.subjects.size > 0); // 신뢰 가능한 구체 대상이 없으면 비교하지 않음
  if (rules.length > MAX_RULES) return [];

  const out: Diagnostic[] = [];
  for (let a = 0; a < rules.length; a++) {
    for (let b = a + 1; b < rules.length; b++) {
      const A = rules[a]!;
      const B = rules[b]!;
      // 같은 settingKV 키 → 결정론 conflict 엔진(Tier-0)이 담당 → 중복 회피
      if (A.i.settingKV && B.i.settingKV && A.i.settingKV.key === B.i.settingKV.key) continue;
      if (scopeRelation(A.i.scope, B.i.scope) === 'disjoint') continue;
      const subject = shareSubject(A.subjects, B.subjects);
      if (!subject) continue; // 같은 구체 대상을 공유하지 않으면 모순 후보 아님(상보/무관)
      const opposed = (A.i.polarity === 'prohibition') !== (B.i.polarity === 'prohibition');
      const score = await scorer(declarativize(A.i.normalized, A.i.directive), declarativize(B.i.normalized, B.i.directive));
      if (score >= threshold) out.push(nliDiag(A.i, B.i, score, subject, opposed));
    }
  }
  return out;
}
