import { describe, it, expect } from 'vitest';
import { scanText, type CodeIndex } from '../src/codeindex/scan';
import { checkCodeDrift } from '../src/analyze/engines/codedrift';
import { parsedFile, makeCtx } from './helpers';

describe('scanText (deprecation detector)', () => {
  it('finds an @deprecated class and parses its replacement', () => {
    const code = ['/**', ' * @deprecated Use `NewClient` instead.', ' */', 'export class OldClient {}', ''].join('\n');
    const syms = scanText(code, 'src/client.ts');
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'OldClient', replacement: 'NewClient', deprecated: true });
  });

  it('finds a Go // Deprecated function', () => {
    const syms = scanText('// Deprecated: use NewThing.\nfunc OldThing() {}', 'main.go');
    expect(syms[0]?.name).toBe('OldThing');
  });

  it('finds a Rust #[deprecated] fn', () => {
    const syms = scanText('#[deprecated(note = "use new_thing")]\npub fn old_thing() {}', 'lib.rs');
    expect(syms[0]?.name).toBe('old_thing');
  });

  it('finds a C# [Obsolete] method', () => {
    const syms = scanText('[Obsolete("use NewApi")]\npublic void OldApi() {}', 'Api.cs');
    expect(syms[0]?.name).toBe('OldApi');
  });

  it('ignores @deprecated inside a string literal (precision guard)', () => {
    const syms = scanText('const msg = "@deprecated do not use";\nexport const x = 1;', 'src/s.ts');
    expect(syms).toHaveLength(0);
  });
});

const idxWith = (name: string, replacement?: string): CodeIndex => ({
  deprecated: [{ name, file: 'src/x.ts', line: 3, deprecated: true, replacement }],
  declaredNames: new Set([name]),
  fileCount: 1,
});

describe('checkCodeDrift (Code→Rule, headline)', () => {
  it('flags missing-guard-rule when no rule mentions the deprecated symbol', () => {
    const ctx = makeCtx([parsedFile('- Use the repository pattern.\n')], { codeIndex: idxWith('OldClient', 'NewClient') });
    const d = checkCodeDrift(ctx).find((x) => x.checkId === 'drift/missing-guard-rule');
    expect(d).toBeDefined();
    expect(d?.fix?.kind).toBe('assisted');
    expect(d?.message).toContain('NewClient');
  });

  it('does NOT flag when a rule already prohibits the symbol', () => {
    const ctx = makeCtx([parsedFile('- Do not use `OldClient`.\n')], { codeIndex: idxWith('OldClient') });
    expect(checkCodeDrift(ctx).some((x) => x.checkId === 'drift/missing-guard-rule')).toBe(false);
  });

  it('flags deprecated-symbol-recommended when a rule recommends it', () => {
    const ctx = makeCtx([parsedFile('- Always use `OldClient` for requests.\n')], { codeIndex: idxWith('OldClient', 'NewClient') });
    expect(checkCodeDrift(ctx).some((x) => x.checkId === 'drift/deprecated-symbol-recommended')).toBe(true);
  });

  it('returns nothing when no code index is present', () => {
    const ctx = makeCtx([parsedFile('- whatever rule.\n')]);
    expect(checkCodeDrift(ctx)).toHaveLength(0);
  });
});
