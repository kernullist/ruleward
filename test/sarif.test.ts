import { describe, it, expect } from 'vitest';
import { toSarif } from '../src/report/sarif';
import type { Diagnostic } from '../src/diagnostics';

const diags: Diagnostic[] = [
  {
    checkId: 'conflict/setting-collision',
    engine: 'conflict',
    severity: 'error',
    confidence: 0.99,
    message: 'style.indent conflict',
    location: { file: 'AGENTS.md', line: 9 },
    related: [{ loc: { file: 'style.mdc', line: 4 }, role: "다른 값 'space'" }],
    fix: { kind: 'auto', description: 'delete', edits: [{ file: 'AGENTS.md', line: 9, newText: '', mode: 'delete' }] },
    fingerprint: 'abc123',
  },
  {
    checkId: 'drift/missing-guard-rule',
    engine: 'drift',
    severity: 'info',
    confidence: 0.5,
    message: 'OldClient deprecated',
    location: { file: 'AGENTS.md', line: 30 },
    fingerprint: 'def456',
  },
];

describe('toSarif', () => {
  const s = toSarif(diags, '1.2.3') as Record<string, any>;

  it('produces a valid SARIF 2.1.0 envelope', () => {
    expect(s['version']).toBe('2.1.0');
    expect(s['runs'][0].tool.driver.name).toBe('ruleward');
    expect(s['runs'][0].tool.driver.version).toBe('1.2.3');
    expect(s['runs'][0].tool.driver.rules).toHaveLength(2);
  });

  it('maps severity → level (info → note) and keeps fingerprints', () => {
    const results = s['runs'][0].results;
    expect(results[0].ruleId).toBe('conflict/setting-collision');
    expect(results[0].level).toBe('error');
    expect(results[1].level).toBe('note');
    expect(results[0].partialFingerprints['ruleward/v1']).toBe('abc123');
  });

  it('maps related → relatedLocations and auto fix → fixes', () => {
    const r0 = s['runs'][0].results[0];
    expect(r0.relatedLocations).toHaveLength(1);
    expect(r0.relatedLocations[0].physicalLocation.artifactLocation.uri).toBe('style.mdc');
    expect(r0.fixes).toHaveLength(1);
    expect(r0.fixes[0].artifactChanges[0].artifactLocation.uri).toBe('AGENTS.md');
  });
});
