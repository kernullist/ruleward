import { describe, it, expect } from 'vitest';
import { checkConflicts } from '../src/analyze/engines/conflict';
import { parsedFile, makeCtx, BROAD, NARROW } from './helpers';

describe('conflict engine', () => {
  it('setting-collision (error) for same-scope contradictory values', () => {
    const ctx = makeCtx([parsedFile('- Use tabs for indentation.\n- Use spaces for indentation.\n')]);
    const diags = checkConflicts(ctx);
    const c = diags.find((d) => d.checkId === 'conflict/setting-collision');
    expect(c).toBeDefined();
    expect(c?.severity).toBe('error');
    expect(c?.related?.length).toBe(1);
  });

  it('scoped-override (info) when the narrower scope contradicts the broader', () => {
    const ctx = makeCtx([
      parsedFile('- Use tabs for indentation.\n', BROAD, 'AGENTS.md'),
      parsedFile('- Use spaces for indentation.\n', NARROW, 'style.mdc'),
    ]);
    const diags = checkConflicts(ctx);
    expect(diags.some((d) => d.checkId === 'conflict/scoped-override' && d.severity === 'info')).toBe(true);
    expect(diags.some((d) => d.checkId === 'conflict/setting-collision')).toBe(false);
  });

  it('prohibit-vs-require (error) when a path is both restricted and preferred', () => {
    const ctx = makeCtx([parsedFile('- Never import from `src/legacy`.\n- Always import from `src/legacy`.\n')]);
    const diags = checkConflicts(ctx);
    expect(diags.some((d) => d.checkId === 'conflict/prohibit-vs-require' && d.severity === 'error')).toBe(true);
  });
});
