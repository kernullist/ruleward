import type { EngineName } from '../diagnostics';

/**
 * Planted-fault 벤치마크 케이스 (DEEP-DIVE §D).
 * 각 케이스 = 결함을 심은(또는 clean한) 합성 프로젝트 + ground-truth(expect).
 * 케이스는 "심은 결함 외엔 깨끗"하게 설계 → expect에 없는 진단은 곧 FP.
 */

export interface ExpectItem {
  checkId: string;
  /** 메시지에 포함돼야 할 부분문자열(심볼/키 등). */
  contains?: string;
}

export interface BenchCase {
  name: string;
  engine: EngineName | 'negative';
  files: Record<string, string>;
  expect: ExpectItem[];
  /** FP 집계에서 제외할 checkId(부수적·허용 가능 진단). */
  ignore?: string[];
}

const DEPRECATED_TS = [
  '/**',
  ' * @deprecated Use `NewClient` instead.',
  ' */',
  'export class OldClient {}',
  'export class NewClient {}',
  '',
].join('\n');

const BIG_PARAGRAPH = `${'lorem ipsum dolor sit amet consectetur '.repeat(1100)}`;

export const CASES: BenchCase[] = [
  // ---------- conflict ----------
  {
    name: 'conflict/setting-collision (same scope tab vs space)',
    engine: 'conflict',
    files: { 'AGENTS.md': '# R\n\n- Use tabs for indentation.\n- Use spaces for indentation.\n' },
    expect: [{ checkId: 'conflict/setting-collision', contains: 'style.indent' }],
  },
  {
    name: 'conflict/scoped-override (broad tab, narrow space)',
    engine: 'conflict',
    files: {
      'AGENTS.md': '# R\n\n- Use tabs for indentation.\n',
      '.cursor/rules/style.mdc': '---\nglobs:\n  - "src/**/*.ts"\nalwaysApply: false\n---\n\n- Use spaces for indentation.\n',
    },
    expect: [{ checkId: 'conflict/scoped-override' }],
  },
  {
    name: 'conflict/prohibit-vs-require (same import target)',
    engine: 'conflict',
    files: { 'AGENTS.md': '# R\n\n- Never import from `src/legacy`.\n- Always import from `src/legacy`.\n' },
    expect: [{ checkId: 'conflict/prohibit-vs-require' }],
    ignore: ['drift/dangling-path'], // src/legacy 미존재는 이 케이스의 관심사 아님
  },
  {
    name: 'conflict negative (different keys)',
    engine: 'negative',
    files: { 'AGENTS.md': '# R\n\n- Use tabs for indentation.\n- Use single quotes.\n' },
    expect: [],
  },

  // ---------- duplication ----------
  {
    name: 'duplication/redundant-with-config (packageManager)',
    engine: 'duplication',
    files: { 'package.json': '{"name":"x","packageManager":"pnpm@9.0.0"}\n', 'AGENTS.md': '# R\n\n- Use pnpm.\n' },
    expect: [{ checkId: 'duplication/redundant-with-config' }],
  },
  {
    name: 'duplication/redundant-with-config (prettier singleQuote)',
    engine: 'duplication',
    files: { '.prettierrc': '{"singleQuote":true}\n', 'AGENTS.md': '# R\n\n- Use single quotes.\n' },
    expect: [{ checkId: 'duplication/redundant-with-config' }],
  },
  {
    name: 'duplication/rule-rule (exact across files)',
    engine: 'duplication',
    files: { 'AGENTS.md': '# R\n\n- Always use single quotes.\n', 'CLAUDE.md': '# R\n\n- Always use single quotes.\n' },
    expect: [{ checkId: 'duplication/rule-rule' }],
  },
  {
    name: 'duplication negative (unique rule, no matching config)',
    engine: 'negative',
    files: { 'package.json': '{"name":"x"}\n', 'AGENTS.md': '# R\n\n- Group imports by origin.\n' },
    expect: [],
  },

  // ---------- bloat ----------
  {
    name: 'bloat/vague',
    engine: 'bloat',
    files: { 'AGENTS.md': '# R\n\n- Write clean, maintainable code.\n' },
    expect: [{ checkId: 'bloat/vague' }],
  },
  {
    name: 'bloat/token-budget (oversized always-on file)',
    engine: 'bloat',
    files: { 'AGENTS.md': `# R\n\n${BIG_PARAGRAPH}\n` },
    expect: [{ checkId: 'bloat/token-budget' }],
  },
  {
    name: 'bloat negative (concrete rule)',
    engine: 'negative',
    files: { 'AGENTS.md': '# R\n\n- Return early instead of nesting conditionals.\n' },
    expect: [],
  },

  // ---------- drift: Rule -> Code ----------
  {
    name: 'drift/dangling-path (missing dir)',
    engine: 'drift',
    files: { 'AGENTS.md': '# R\n\n- Never import from `src/legacy/*`.\n' },
    expect: [{ checkId: 'drift/dangling-path', contains: 'src/legacy' }],
  },
  {
    name: 'drift dangling negative (path exists)',
    engine: 'negative',
    files: { 'AGENTS.md': '# R\n\n- Never import from `src/legacy/*`.\n', 'src/legacy/index.ts': 'export const x = 1;\n' },
    expect: [],
  },
  {
    name: 'drift/stale-command (missing script)',
    engine: 'drift',
    files: { 'package.json': '{"name":"x","scripts":{"test":"vitest","dev":"tsx"}}\n', 'AGENTS.md': '# R\n\n- Run `pnpm build` before committing.\n' },
    expect: [{ checkId: 'drift/stale-command', contains: 'build' }],
  },
  {
    name: 'drift/stale-dependency (declared framework not installed)',
    engine: 'drift',
    files: { 'package.json': '{"name":"x","devDependencies":{"vitest":"^2"}}\n', 'AGENTS.md': '# R\n\n- Use jest for tests.\n' },
    expect: [{ checkId: 'drift/stale-dependency', contains: 'jest' }],
  },
  {
    name: 'drift/broken-alias (alias not in tsconfig paths)',
    engine: 'drift',
    files: { 'tsconfig.json': '{"compilerOptions":{"strict":true}}\n', 'AGENTS.md': '# R\n\n- Import from `@core/utils`.\n' },
    expect: [{ checkId: 'drift/broken-alias', contains: '@core' }],
  },

  // ---------- drift: Code -> Rule (headline) ----------
  {
    name: 'drift/missing-guard-rule (deprecated symbol, no guard)',
    engine: 'drift',
    files: { 'src/client.ts': DEPRECATED_TS, 'AGENTS.md': '# R\n\n- Use the repository pattern.\n' },
    expect: [{ checkId: 'drift/missing-guard-rule', contains: 'OldClient' }],
  },
  {
    name: 'drift missing-guard negative (rule already prohibits it)',
    engine: 'negative',
    files: { 'src/client.ts': DEPRECATED_TS, 'AGENTS.md': '# R\n\n- Do not use `OldClient`.\n' },
    expect: [],
  },
  {
    name: 'drift/deprecated-symbol-recommended (rule recommends deprecated)',
    engine: 'drift',
    files: { 'src/client.ts': DEPRECATED_TS, 'AGENTS.md': '# R\n\n- Always use `OldClient` for requests.\n' },
    expect: [{ checkId: 'drift/deprecated-symbol-recommended', contains: 'OldClient' }],
  },
  {
    name: 'drift/stale-symbol (rule references a removed symbol)',
    engine: 'drift',
    files: { 'src/svc.ts': 'export class CurrentService {}\n', 'AGENTS.md': '# R\n\n- Always use `LegacyService` for requests.\n' },
    expect: [{ checkId: 'drift/stale-symbol', contains: 'LegacyService' }],
  },
  {
    name: 'drift stale-symbol negative (symbol exists)',
    engine: 'negative',
    files: { 'src/svc.ts': 'export class CurrentService {}\n', 'AGENTS.md': '# R\n\n- Always use `CurrentService` for requests.\n' },
    expect: [],
  },
  {
    name: 'drift stale-symbol negative (builtin global)',
    engine: 'negative',
    files: { 'src/svc.ts': 'export const helper = 1;\n', 'AGENTS.md': '# R\n\n- Wrap async work in `Promise`.\n' },
    expect: [],
  },

  // ---------- real-world FP regressions (from the corpus run) ----------
  {
    name: 'regression: multiple test frameworks coexist (not a conflict)',
    engine: 'negative',
    files: { 'AGENTS.md': '# R\n\n- Use jest for unit tests.\n- Use playwright for e2e tests.\n' },
    expect: [],
  },
  {
    name: 'regression: different language versions are not a conflict',
    engine: 'negative',
    files: { 'AGENTS.md': '# R\n\n- Target TypeScript 5.6 for the app.\n- Run on Node 24 in production.\n' },
    expect: [],
  },
  {
    name: 'regression: short repeated label is not a duplicate rule',
    engine: 'negative',
    files: { 'AGENTS.md': '# R\n\n- Must have\n- Validate inputs at the boundary thoroughly.\n- Must have\n- Log structured errors with context always.\n- Must have\n' },
    expect: [],
  },
  {
    name: 'regression: incidental trigger word in a concrete rule is not vague',
    engine: 'negative',
    files: { 'AGENTS.md': '# R\n\n- Ensure JSON-RPC messages are properly formatted.\n' },
    expect: [],
  },
  {
    name: 'regression: a generic word is not an import target',
    engine: 'negative',
    files: { 'AGENTS.md': '# R\n\n- Never import from module.\n- Always import from module.\n' },
    expect: [],
  },

  // ---------- clean project (no-noise-bomb) ----------
  {
    name: 'clean project (zero diagnostics)',
    engine: 'negative',
    files: {
      'AGENTS.md': '# Billing service\n\nThis service handles billing.\n\n## Conventions\n\n- Validate all external input at the boundary.\n- Log errors with structured context.\n',
    },
    expect: [],
  },
];
