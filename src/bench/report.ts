import type { BenchReport } from './run';

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function prf(s: { tp: number; fp: number; fn: number }): { p: number; r: number; f1: number } {
  const p = s.tp + s.fp === 0 ? 1 : s.tp / (s.tp + s.fp);
  const r = s.tp + s.fn === 0 ? 1 : s.tp / (s.tp + s.fn);
  const f1 = p + r === 0 ? 0 : (2 * p * r) / (p + r);
  return { p, r, f1 };
}

export function formatReport(report: BenchReport): string {
  const { results, byCheck, totals } = report;
  const lines: string[] = [];

  lines.push('═══ ail planted-fault benchmark ═══\n');

  // per-check 표
  lines.push('Check                                 TP  FP  FN   P     R     F1');
  lines.push('─'.repeat(72));
  for (const [id, s] of [...byCheck.entries()].sort()) {
    const { p, r, f1 } = prf(s);
    lines.push(
      `${id.padEnd(36)} ${String(s.tp).padStart(3)} ${String(s.fp).padStart(3)} ${String(s.fn).padStart(3)}  ${pct(p).padStart(4)}  ${pct(r).padStart(4)}  ${pct(f1).padStart(4)}`
    );
  }

  // 실패한 케이스(FP/FN) 상세
  const bad = results.filter((c) => c.fp > 0 || c.fn > 0);
  if (bad.length > 0) {
    lines.push('\n── 문제 케이스 ──');
    for (const c of bad) {
      lines.push(`✗ ${c.name}`);
      for (const m of c.missing) lines.push(`    FN(누락): ${m}`);
      for (const f of c.fps) lines.push(`    FP(오탐): ${f.severity} ${f.checkId} — ${f.message.slice(0, 70)}`);
    }
  }

  const recall = totals.tp + totals.fn === 0 ? 1 : totals.tp / (totals.tp + totals.fn);
  const precision = totals.tp + totals.fp === 0 ? 1 : totals.tp / (totals.tp + totals.fp);

  lines.push('\n── 총계 ──');
  lines.push(`케이스 ${totals.cases} · TP ${totals.tp} · FP ${totals.fp} · FN ${totals.fn}`);
  lines.push(`precision ${pct(precision)} · recall ${pct(recall)}`);
  lines.push(`음성(clean) 케이스 FP: ${totals.negativeFp}  (목표 0)`);
  lines.push(`error 심각도 FP: ${totals.errorFp}  (목표 0 — 결정론만 error 승격 검증)`);

  return lines.join('\n');
}
