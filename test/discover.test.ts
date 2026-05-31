import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover } from '../src/discovery/discover';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');

describe('discover', () => {
  it('finds AGENTS.md and the .mdc rule file', async () => {
    const files = await discover(fixtures);
    const formats = files.map((f) => f.format);
    expect(formats).toContain('agents');
    expect(formats).toContain('cursor-mdc');
  });

  it('derives scope from .mdc frontmatter', async () => {
    const files = await discover(fixtures);
    const mdc = files.find((f) => f.format === 'cursor-mdc');
    expect(mdc?.scope.loading).toBe('auto-attached');
    expect(mdc?.scope.globs).toContain('src/**/*.ts');
  });
});
