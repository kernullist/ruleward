import { describe, it, expect } from 'vitest';
import { parseInstructions } from '../src/parse/parseFile';
import type { RuleFile } from '../src/types';

const body = [
  '# Project Rules',
  '',
  'This project is a TypeScript service.',
  '',
  '## Code Style',
  '',
  '- Use tabs for indentation.',
  '- Write clean, maintainable code.',
  '',
  '## Architecture',
  '',
  '- Never import from `src/legacy/*`; use `@core/*` instead.',
  '',
].join('\n');

const file: RuleFile = {
  relPath: 'AGENTS.md',
  absPath: '/AGENTS.md',
  format: 'agents',
  frontmatter: {},
  body,
  scope: { globs: ['**'], loading: 'always', dirBoundary: '.' },
};

describe('parseInstructions', () => {
  const ins = parseInstructions(file);

  it('extracts settingKV + heading path for a style rule', () => {
    const tabs = ins.find((i) => i.settingKV?.key === 'style.indent');
    expect(tabs?.settingKV?.value).toBe('tab');
    expect(tabs?.source.headingPath).toEqual(['Project Rules', 'Code Style']);
    expect(tabs?.category).toBe('style');
    expect(tabs?.directive).toBe('SHOULD');
  });

  it('splits a compound rule on semicolon and keeps referents', () => {
    const neverImport = ins.find((i) => i.directive === 'MUST_NOT');
    expect(neverImport).toBeDefined();
    expect(neverImport?.fromCompound).toBe(true);
    expect(neverImport?.codeReferents.some((r) => r.value === 'src/legacy/*')).toBe(true);
  });

  it('classifies a vague rule (no settingKV, quality category)', () => {
    const clean = ins.find((i) => /clean/.test(i.raw));
    expect(clean?.settingKV).toBeNull();
    expect(clean?.category).toBe('quality');
  });

  it('marks declarative prose as narrative', () => {
    const prose = ins.find((i) => /TypeScript service/.test(i.raw));
    expect(prose?.atomicity).toBe('narrative');
  });

  it('assigns stable ids and positive token counts', () => {
    expect(ins.length).toBeGreaterThan(0);
    expect(ins.every((i) => i.id.startsWith('AGENTS.md#'))).toBe(true);
    expect(ins.every((i) => i.tokens > 0)).toBe(true);
  });
});
