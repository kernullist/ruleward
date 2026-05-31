import { describe, it, expect } from 'vitest';
import { checkBloat } from '../src/analyze/engines/bloat';
import { parsedFile, makeCtx } from './helpers';

describe('bloat engine', () => {
  it('flags a vague rule', () => {
    const ctx = makeCtx([parsedFile('- Write clean, maintainable code.\n')]);
    const d = checkBloat(ctx).find((x) => x.checkId === 'bloat/vague');
    expect(d).toBeDefined();
    expect(d?.severity).toBe('info');
  });

  it('does not flag a concrete rule', () => {
    const ctx = makeCtx([parsedFile('- Use tabs for indentation.\n')]);
    expect(checkBloat(ctx).some((d) => d.checkId === 'bloat/vague')).toBe(false);
  });

  it('flags an always-on file over the token budget', () => {
    const big = `${'alpha beta gamma delta '.repeat(700)}`;
    const ctx = makeCtx([parsedFile(big)]);
    expect(checkBloat(ctx).some((d) => d.checkId === 'bloat/token-budget')).toBe(true);
  });
});
