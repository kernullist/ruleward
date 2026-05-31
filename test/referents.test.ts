import { describe, it, expect } from 'vitest';
import { extractReferents } from '../src/extract/referents';

describe('extractReferents', () => {
  it('classifies a path in a backtick span', () => {
    const r = extractReferents('never import from `src/legacy/*`');
    expect(r).toContainEqual({ kind: 'path', value: 'src/legacy/*', confidence: 0.85 });
  });

  it('classifies a command', () => {
    const r = extractReferents('run `pnpm build` before committing');
    expect(r.some((x) => x.kind === 'command' && x.value === 'pnpm build')).toBe(true);
  });

  it('classifies an @scope alias', () => {
    const r = extractReferents('use `@core/utils` instead');
    expect(r.some((x) => x.kind === 'alias' && x.value === '@core/utils')).toBe(true);
  });

  it('classifies a CamelCase symbol (backtick only)', () => {
    const r = extractReferents('do not use `OldClient`');
    expect(r.some((x) => x.kind === 'symbol' && x.value === 'OldClient')).toBe(true);
  });

  it('does NOT treat a bare capitalized English word as a symbol', () => {
    const r = extractReferents('use the Button component carefully');
    expect(r.some((x) => x.kind === 'symbol')).toBe(false);
  });
});
