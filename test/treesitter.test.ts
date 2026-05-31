import { describe, it, expect } from 'vitest';
import { getRuntime, scanWithRuntime } from '../src/codeindex/treesitter';

// tree-sitter 미가용 환경에서도 CI가 깨지지 않도록 런타임 없으면 graceful skip.
describe('tree-sitter scanner (precise deprecation)', () => {
  it('finds an @deprecated class via AST', async () => {
    const pool = await getRuntime();
    if (!pool) return expect(true).toBe(true);
    const code = '/**\n * @deprecated Use `NewClient` instead.\n */\nexport class OldClient {}\n';
    const syms = scanWithRuntime(pool, code, 'src/client.ts');
    expect(syms?.some((s) => s.name === 'OldClient' && s.replacement === 'NewClient')).toBe(true);
  });

  it('does not mis-attribute to an unrelated declaration (precision over regex)', async () => {
    const pool = await getRuntime();
    if (!pool) return expect(true).toBe(true);
    // 주석은 "approach"에 대한 것이고 다음 노드는 import → 그 아래 함수에 오귀속하면 안 됨
    const code = '// @deprecated this whole approach\nimport { foo } from "./x";\nexport function goodFn() {}\n';
    const syms = scanWithRuntime(pool, code, 'src/x.ts');
    expect(syms?.some((s) => s.name === 'goodFn')).toBe(false);
  });

  it('ignores @deprecated inside a string literal (AST knows it is not a comment)', async () => {
    const pool = await getRuntime();
    if (!pool) return expect(true).toBe(true);
    const code = 'export const msg = "@deprecated do not use";\n';
    const syms = scanWithRuntime(pool, code, 'src/s.ts');
    expect(syms).toEqual([]);
  });

  it('returns null for unsupported extensions (→ regex fallback)', async () => {
    const pool = await getRuntime();
    if (!pool) return expect(true).toBe(true);
    expect(scanWithRuntime(pool, '#[deprecated]\npub fn x() {}', 'lib.rs')).toBeNull();
  });
});
