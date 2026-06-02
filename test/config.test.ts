import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzePath } from '../src/analyze/run';
import { matchesCheck } from '../src/config';

describe('matchesCheck', () => {
  it('matches by engine, exact checkId, and prefix', () => {
    const d = { checkId: 'bloat/vague', engine: 'bloat' };
    expect(matchesCheck(d, ['bloat'])).toBe(true);
    expect(matchesCheck(d, ['bloat/vague'])).toBe(true);
    expect(matchesCheck(d, ['drift'])).toBe(false);
  });
});

describe('.rulewardrc', () => {
  it('disable drops matching diagnostics', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rw-cfg-'));
    try {
      await writeFile(path.join(dir, 'AGENTS.md'), '# R\n\n- Write clean, maintainable code.\n', 'utf8');
      const base = await analyzePath(dir);
      expect(base.diagnostics.some((d) => d.checkId === 'bloat/vague')).toBe(true);

      await writeFile(path.join(dir, '.rulewardrc.json'), JSON.stringify({ disable: ['bloat/vague'] }), 'utf8');
      const off = await analyzePath(dir);
      expect(off.diagnostics.some((d) => d.checkId === 'bloat/vague')).toBe(false);
      expect(off.settings.disable).toContain('bloat/vague');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('ignore excludes a rule file from discovery', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rw-cfg2-'));
    try {
      await writeFile(path.join(dir, 'AGENTS.md'), '# R\n\n- Use tabs.\n- Use spaces.\n', 'utf8');
      await writeFile(path.join(dir, '.rulewardrc.json'), JSON.stringify({ ignore: ['**/AGENTS.md'] }), 'utf8');
      const res = await analyzePath(dir);
      expect(res.files.length).toBe(0);
      expect(res.diagnostics.length).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
