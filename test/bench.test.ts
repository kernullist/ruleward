import { describe, it, expect, beforeAll } from 'vitest';
import { runBench, type BenchReport } from '../src/bench/run';

describe('planted-fault benchmark', () => {
  let report: BenchReport;

  beforeAll(async () => {
    report = await runBench();
  }, 60_000);

  it('no false positives on clean/negative projects', () => {
    const offenders = report.results
      .filter((r) => r.engine === 'negative' && r.fp > 0)
      .map((r) => `${r.name}: ${r.fps.map((f) => f.checkId).join(',')}`);
    expect(offenders).toEqual([]);
  });

  it('no error-severity false positives (only deterministic checks escalate)', () => {
    const errorFps = report.results.flatMap((r) => r.fps.filter((f) => f.severity === 'error').map((f) => `${r.name}: ${f.checkId}`));
    expect(errorFps).toEqual([]);
  });

  it('recall >= 0.85 across planted faults', () => {
    const recall = report.totals.tp / (report.totals.tp + report.totals.fn);
    expect(recall).toBeGreaterThanOrEqual(0.85);
  });
});
