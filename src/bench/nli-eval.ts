import { getNliScorer, declarativize } from '../semantic/nli';
import type { Directive } from '../types';

/**
 * NLI(의미 충돌) 베이스라인 평가 — opt-in 계층의 FP 프로파일을 투명하게 측정.
 * `npm run bench:nli` (모델 다운로드 필요, CI 미포함). 결정론 게이트와 별개.
 */

interface Pair {
  a: string;
  da: Directive;
  b: string;
  db: Directive;
  contradict: boolean;
}

const PAIRS: Pair[] = [
  // 진짜 모순
  { a: 'keep functions small and focused', da: 'SHOULD', b: 'prefer large comprehensive functions that handle all cases', db: 'SHOULD', contradict: true },
  { a: 'write tests before writing code', da: 'MUST', b: 'never write tests before writing code', db: 'MUST_NOT', contradict: true },
  { a: 'avoid comments; code should be self-documenting', da: 'SHOULD_NOT', b: 'document every function with a comment', db: 'MUST', contradict: true },
  { a: 'prefer composition over inheritance', da: 'SHOULD', b: 'use class inheritance for shared behavior', db: 'SHOULD', contradict: true },
  { a: 'throw exceptions on errors', da: 'MUST', b: 'return error values instead of throwing', db: 'MUST', contradict: true },
  // 호환(같은 토픽 포함)
  { a: 'keep functions small', da: 'SHOULD', b: 'keep functions pure', db: 'SHOULD', contradict: false },
  { a: 'write unit tests for new code', da: 'MUST', b: 'write integration tests for apis', db: 'SHOULD', contradict: false },
  { a: 'validate external input at the boundary', da: 'MUST', b: 'log errors with structured context', db: 'SHOULD', contradict: false },
  { a: 'use dependency injection for services', da: 'SHOULD', b: 'keep modules small and focused', db: 'SHOULD', contradict: false },
  { a: 'document public apis', da: 'SHOULD', b: 'document complex logic', db: 'SHOULD', contradict: false },
];

const THRESHOLDS = [0.7, 0.8, 0.9, 0.95];

const scorer = await getNliScorer();
if (!scorer) {
  console.error('NLI 모델을 로드할 수 없습니다(@xenova/transformers 미설치 또는 다운로드 실패).');
  process.exit(1);
}

const scored: Array<Pair & { s: number }> = [];
for (const p of PAIRS) {
  const s = await scorer(declarativize(p.a, p.da), declarativize(p.b, p.db));
  scored.push({ ...p, s });
}

console.log('NLI contradiction score (declarativized):');
for (const r of scored.sort((x, y) => y.s - x.s)) {
  console.log(`  ${r.s.toFixed(3)} [${r.contradict ? 'contradict ' : 'compatible'}]  "${r.a}" ⟂ "${r.b}"`);
}

console.log('\n threshold  precision  recall   (positive = contradiction)');
for (const t of THRESHOLDS) {
  const tp = scored.filter((r) => r.contradict && r.s >= t).length;
  const fp = scored.filter((r) => !r.contradict && r.s >= t).length;
  const fn = scored.filter((r) => r.contradict && r.s < t).length;
  const p = tp + fp ? tp / (tp + fp) : 1;
  const rc = tp + fn ? tp / (tp + fn) : 1;
  console.log(`   ${t.toFixed(2)}      ${(p * 100).toFixed(0).padStart(3)}%       ${(rc * 100).toFixed(0).padStart(3)}%    (tp ${tp}, fp ${fp}, fn ${fn})`);
}
