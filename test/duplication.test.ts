import { describe, it, expect } from 'vitest';
import { checkDuplication } from '../src/analyze/engines/duplication';
import { parsedFile, makeCtx, BROAD } from './helpers';

describe('duplication engine (redundant-with-config)', () => {
  it('flags packageManager rule already declared in package.json', () => {
    const ctx = makeCtx([parsedFile('- Use pnpm.\n')], {
      config: { hasPackageJson: true, packageManager: 'pnpm' },
    });
    expect(checkDuplication(ctx).some((d) => d.checkId === 'duplication/redundant-with-config')).toBe(true);
  });

  it('flags style rule already enforced by the formatter', () => {
    const ctx = makeCtx([parsedFile('- Use single quotes.\n')], {
      config: { style: { 'style.quotes': 'single' } },
    });
    const d = checkDuplication(ctx).find((x) => x.checkId === 'duplication/redundant-with-config');
    expect(d?.fix?.kind).toBe('auto');
  });

  it('does not flag when config does not declare it', () => {
    const ctx = makeCtx([parsedFile('- Use pnpm.\n')], { config: { hasPackageJson: true } });
    expect(checkDuplication(ctx).length).toBe(0);
  });

  it('flags an exact duplicate rule across files', () => {
    const ctx = makeCtx([
      parsedFile('- Always use single quotes.\n', BROAD, 'AGENTS.md'),
      parsedFile('- Always use single quotes.\n', BROAD, 'CLAUDE.md'),
    ]);
    expect(checkDuplication(ctx).some((d) => d.checkId === 'duplication/rule-rule' && d.severity === 'warning')).toBe(true);
  });

  it('flags a near-duplicate (paraphrase) rule', () => {
    const ctx = makeCtx([
      parsedFile('- Always write unit tests for new modules.\n', BROAD, 'a.md'),
      parsedFile('- Always write unit tests for all new modules.\n', BROAD, 'b.md'),
    ]);
    expect(checkDuplication(ctx).some((d) => d.checkId === 'duplication/rule-rule' && d.severity === 'info')).toBe(true);
  });
});
