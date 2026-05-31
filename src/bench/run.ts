import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzePath } from '../analyze/run';
import { CASES } from './cases';

/** planted-fault 벤치마크 실행 + 채점 (DEEP-DIVE §D). */

export interface CaseResult {
  name: string;
  engine: string;
  expected: number;
  tp: number;
  fp: number;
  fn: number;
  fps: Array<{ checkId: string; severity: string; message: string }>;
  missing: string[];
}

export interface CheckStat {
  tp: number;
  fp: number;
  fn: number;
}

export interface BenchReport {
  results: CaseResult[];
  byCheck: Map<string, CheckStat>;
  totals: { tp: number; fp: number; fn: number; negativeFp: number; errorFp: number; cases: number };
}

export async function runBench(): Promise<BenchReport> {
  const results: CaseResult[] = [];
  const byCheck = new Map<string, CheckStat>();
  const stat = (id: string): CheckStat => {
    let s = byCheck.get(id);
    if (!s) {
      s = { tp: 0, fp: 0, fn: 0 };
      byCheck.set(id, s);
    }
    return s;
  };
  const totals = { tp: 0, fp: 0, fn: 0, negativeFp: 0, errorFp: 0, cases: 0 };

  for (const c of CASES) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ail-bench-'));
    try {
      for (const [rel, content] of Object.entries(c.files)) {
        const abs = path.join(dir, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, content, 'utf-8');
      }

      const { diagnostics } = await analyzePath(dir);
      const matched = c.expect.map(() => false);
      const fps: CaseResult['fps'] = [];

      for (const d of diagnostics) {
        if (c.ignore?.includes(d.checkId)) continue;
        const i = c.expect.findIndex(
          (e, idx) => !matched[idx] && e.checkId === d.checkId && (!e.contains || d.message.includes(e.contains))
        );
        if (i >= 0) {
          matched[i] = true;
          stat(d.checkId).tp++;
          totals.tp++;
        } else {
          fps.push({ checkId: d.checkId, severity: d.severity, message: d.message });
          stat(d.checkId).fp++;
          totals.fp++;
          if (d.severity === 'error') totals.errorFp++;
          if (c.engine === 'negative') totals.negativeFp++;
        }
      }

      const missing: string[] = [];
      c.expect.forEach((e, idx) => {
        if (!matched[idx]) {
          stat(e.checkId).fn++;
          totals.fn++;
          missing.push(e.checkId);
        }
      });

      results.push({
        name: c.name,
        engine: c.engine,
        expected: c.expect.length,
        tp: matched.filter(Boolean).length,
        fp: fps.length,
        fn: missing.length,
        fps,
        missing,
      });
      totals.cases++;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  return { results, byCheck, totals };
}
