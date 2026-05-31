import type { Diagnostic, Severity } from '../diagnostics';

const ICON: Record<Severity, string> = { error: '✖', warning: '⚠', info: 'ℹ' };

export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) return '✓ 문제 없음';

  const lines: string[] = [];
  for (const d of diagnostics) {
    const at = d.location.line ? `${d.location.file}:${d.location.line}` : d.location.file;
    lines.push(`${ICON[d.severity]} ${d.severity.toUpperCase().padEnd(7)} ${d.checkId.padEnd(32)} ${at}  (conf ${d.confidence})`);
    lines.push(`    ${d.message}`);
    if (d.related) {
      for (const r of d.related) {
        lines.push(`    ↳ ${r.role}: ${r.loc.file}${r.loc.line ? `:${r.loc.line}` : ''}`);
      }
    }
    if (d.fix) lines.push(`    fix(${d.fix.kind}): ${d.fix.description}`);
    lines.push('');
  }

  const c = { error: 0, warning: 0, info: 0 };
  for (const d of diagnostics) c[d.severity]++;
  lines.push(`Σ ${diagnostics.length} — error ${c.error}, warning ${c.warning}, info ${c.info}`);
  return lines.join('\n');
}
