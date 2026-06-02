import { describe, it, expect } from 'vitest';
import { checkDrift } from '../src/analyze/engines/drift';
import { parsedFile, makeCtx } from './helpers';

describe('drift engine', () => {
  it('dangling-path when a referenced path does not exist', () => {
    const ctx = makeCtx([parsedFile('- Never import from `src/legacy/*`.\n')], { exists: () => false });
    expect(ctx.instructions.some((i) => i.codeReferents.some((r) => r.value === 'src/legacy/*'))).toBe(true);
    const diags = checkDrift(ctx);
    expect(diags.some((d) => d.checkId === 'drift/dangling-path')).toBe(true);
  });

  it('no dangling-path when the path exists', () => {
    const ctx = makeCtx([parsedFile('- Never import from `src/legacy/*`.\n')], { exists: () => true });
    expect(checkDrift(ctx).some((d) => d.checkId === 'drift/dangling-path')).toBe(false);
  });

  it('stale-command (error) when script is missing from package.json', () => {
    const ctx = makeCtx([parsedFile('- Run `pnpm build` before committing.\n')], {
      config: { hasPackageJson: true, scripts: new Set(['test', 'dev']) },
    });
    const d = checkDrift(ctx).find((x) => x.checkId === 'drift/stale-command');
    expect(d?.severity).toBe('error');
  });

  it('stale-dependency when a declared framework is not installed', () => {
    const ctx = makeCtx([parsedFile('- Use jest for tests.\n')], {
      config: { hasPackageJson: true, deps: new Set(['vitest']) },
    });
    expect(checkDrift(ctx).some((d) => d.checkId === 'drift/stale-dependency')).toBe(true);
  });

  it('broken-alias when alias not in tsconfig paths', () => {
    const ctx = makeCtx([parsedFile('- Import from `@core/utils`.\n')], {
      config: { hasTsconfig: true },
    });
    expect(checkDrift(ctx).some((d) => d.checkId === 'drift/broken-alias')).toBe(true);
  });

  it('stale-symbol when a referenced symbol is not declared', () => {
    const ctx = makeCtx([parsedFile('- Always use `LegacyService` for requests.\n')], {
      codeIndex: { deprecated: [], declaredNames: new Set(['CurrentService']), fileCount: 1 },
    });
    expect(checkDrift(ctx).some((d) => d.checkId === 'drift/stale-symbol')).toBe(true);
  });

  it('no stale-symbol when the symbol is declared', () => {
    const ctx = makeCtx([parsedFile('- Always use `CurrentService` for requests.\n')], {
      codeIndex: { deprecated: [], declaredNames: new Set(['CurrentService']), fileCount: 1 },
    });
    expect(checkDrift(ctx).some((d) => d.checkId === 'drift/stale-symbol')).toBe(false);
  });

  it('no stale-symbol for builtin globals', () => {
    const ctx = makeCtx([parsedFile('- Wrap async work in `Promise`.\n')], {
      codeIndex: { deprecated: [], declaredNames: new Set(['helper']), fileCount: 1 },
    });
    expect(checkDrift(ctx).some((d) => d.checkId === 'drift/stale-symbol')).toBe(false);
  });

  it('does not flag a bare filename (no directory) as dangling', () => {
    const ctx = makeCtx([parsedFile('- Configure logging in `logback-test.xml`.\n')], { exists: () => false });
    expect(checkDrift(ctx).some((d) => d.checkId === 'drift/dangling-path')).toBe(false);
  });
});
