import { describe, it, expect } from 'vitest';
import { escalate } from '../src/analyze/run';
import type { Diagnostic, EngineName, Severity } from '../src/diagnostics';

function mk(checkId: string, engine: EngineName, severity: Severity): Diagnostic {
  return { checkId, engine, severity, confidence: 0.8, message: '', location: { file: 'x' }, fingerprint: 'f' };
}

describe('escalate', () => {
  const ds = [mk('drift/dangling-path', 'drift', 'warning'), mk('bloat/vague', 'bloat', 'info')];

  it('escalates a specific checkId to error', () => {
    const e = escalate(ds, ['drift/dangling-path']);
    expect(e[0]?.severity).toBe('error');
    expect(e[1]?.severity).toBe('info');
  });

  it('escalates by engine name', () => {
    const e = escalate(ds, ['bloat']);
    expect(e[1]?.severity).toBe('error');
    expect(e[0]?.severity).toBe('warning');
  });

  it('is a no-op with empty patterns', () => {
    expect(escalate(ds, [])[0]?.severity).toBe('warning');
  });
});
