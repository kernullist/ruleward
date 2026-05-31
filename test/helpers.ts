import type { AnalysisContext } from '../src/analyze/context';
import type { ConfigFacts } from '../src/analyze/configFacts';
import type { RuleFile, Scope, ParsedFile } from '../src/types';
import { parseInstructions } from '../src/parse/parseFile';

export function emptyConfig(over: Partial<ConfigFacts> = {}): ConfigFacts {
  return {
    hasPackageJson: false,
    hasTsconfig: false,
    deps: new Set(),
    scripts: new Set(),
    tsAliases: [],
    tsAliasScopes: [],
    style: {},
    ...over,
  };
}

export const BROAD: Scope = { globs: ['**'], loading: 'always', dirBoundary: '.' };
export const NARROW: Scope = { globs: ['src/**/*.ts'], loading: 'auto-attached', dirBoundary: 'src' };

export function parsedFile(body: string, scope: Scope = BROAD, relPath = 'AGENTS.md'): ParsedFile {
  const file: RuleFile = { relPath, absPath: `/${relPath}`, format: 'agents', frontmatter: {}, body, scope };
  return { file, instructions: parseInstructions(file) };
}

export function makeCtx(
  files: ParsedFile[],
  opts: { config?: Partial<ConfigFacts>; exists?: (p: string) => boolean } = {}
): AnalysisContext {
  return {
    root: '/',
    files,
    instructions: files.flatMap((f) => f.instructions),
    config: emptyConfig(opts.config),
    exists: opts.exists ?? ((): boolean => false),
  };
}
