import type { AnalysisContext } from '../context';
import type { Instruction } from '../../types';
import { type Diagnostic, fingerprint } from '../../diagnostics';
import { scopeRelation } from '../scopeRel';
import { declarativize, type NliScorer } from '../../semantic/nli';

/**
 * conflict/nli-contradiction (opt-in 실험 계층) — settingKV로 환원 안 되는 자연어 의미 모순.
 * FP 통제: 같은 토픽 쌍만(off-distribution 방지), 결정론 Tier-0와 중복 회피, info 심각도.
 */

const DEFAULT_THRESHOLD = 0.9;
const MAX_RULES = 200; // O(n^2) 폭주 방지

const TOPIC_STOP = new Set([
  'the', 'and', 'for', 'with', 'all', 'any', 'every', 'into', 'from', 'this', 'that', 'your', 'our',
  'use', 'using', 'used', 'keep', 'write', 'prefer', 'avoid', 'always', 'never', 'should', 'must',
  'code', 'codebase', 'project', 'when', 'where', 'only', 'also', 'each', 'per', 'via', 'not',
  'make', 'ensure', 'follow', 'they', 'them', 'than', 'over', 'onto', 'must', 'may', 'can', 'new',
]);

function topicTokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !TOPIC_STOP.has(w))
  );
}

function nliDiag(a: Instruction, b: Instruction, score: number): Diagnostic {
  return {
    checkId: 'conflict/nli-contradiction',
    engine: 'conflict',
    severity: 'info',
    confidence: Number(score.toFixed(3)),
    message: `의미적 모순 후보(검토 필요, NLI ${score.toFixed(2)}): "${a.normalized}" ⟂ "${b.normalized}"`,
    location: { file: a.source.file, line: a.source.line },
    related: [{ loc: { file: b.source.file, line: b.source.line }, role: '상충 후보' }],
    fix: { kind: 'manual', description: '두 룰이 실제로 모순인지 검토 후 하나로 정리' },
    fingerprint: fingerprint(['conflict/nli-contradiction', ...[a.id, b.id].sort()]),
  };
}

/** scorer 주입식(테스트는 mock, 실사용은 getNliScorer 결과). */
export async function checkSemanticConflict(
  ctx: AnalysisContext,
  scorer: NliScorer,
  threshold: number = DEFAULT_THRESHOLD
): Promise<Diagnostic[]> {
  const rules = ctx.instructions.filter(
    (i) =>
      i.atomicity !== 'narrative' &&
      i.directive !== 'INFO' &&
      i.normalized.length > 0 &&
      i.tokens <= 30 && // 긴 산문/다절 문장은 NLI 비교 대상이 아님 (실코퍼스 FP 주범)
      !i.raw.includes('|') // 마크다운 테이블 행 제외 ('required' 같은 트리거어로 오분류되어 들어오는 것 차단)
  );
  if (rules.length > MAX_RULES) return [];

  const topics = rules.map((r) => topicTokens(r.normalized));
  const shares = (i: number, j: number): boolean => {
    for (const w of topics[j]!) if (topics[i]!.has(w)) return true;
    return false;
  };

  const out: Diagnostic[] = [];
  for (let a = 0; a < rules.length; a++) {
    for (let b = a + 1; b < rules.length; b++) {
      const A = rules[a]!;
      const B = rules[b]!;
      // 같은 settingKV 키 → 결정론 conflict 엔진(Tier-0)이 담당 → 중복 회피
      if (A.settingKV && B.settingKV && A.settingKV.key === B.settingKV.key) continue;
      if (scopeRelation(A.scope, B.scope) === 'disjoint') continue;
      if (!shares(a, b)) continue; // 무관 토픽 → NLI off-distribution FP 방지
      const score = await scorer(declarativize(A.normalized, A.directive), declarativize(B.normalized, B.directive));
      if (score >= threshold) out.push(nliDiag(A, B, score));
    }
  }
  return out;
}
