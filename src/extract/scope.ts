import type { FileFormat, Scope, Loading } from '../types';

/** 룰파일 포맷·frontmatter·디렉토리에서 scope 유도 (DEEP-DIVE §A.4). */

function toGlobArray(g: unknown): string[] {
  if (Array.isArray(g)) return g.filter((x): x is string => typeof x === 'string');
  if (typeof g === 'string') {
    return g
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function dirGlob(relDir: string): string {
  const d = relDir.replace(/\\/g, '/').replace(/^\.?\/?/, '').replace(/\/$/, '');
  return d ? `${d}/**` : '**';
}

export function fileScope(
  format: FileFormat,
  frontmatter: Record<string, unknown>,
  relDir: string
): Scope {
  const dirBoundary = relDir.replace(/\\/g, '/') || '.';

  if (format === 'cursor-mdc') {
    const globs = toGlobArray(frontmatter['globs']);
    const always = frontmatter['alwaysApply'] === true;
    let loading: Loading = 'manual';
    if (always) loading = 'always';
    else if (globs.length) loading = 'auto-attached';
    else if (typeof frontmatter['description'] === 'string') loading = 'agent-requested';
    return { globs: globs.length ? globs : [dirGlob(relDir)], loading, dirBoundary };
  }

  if (format === 'copilot') {
    const applyTo = toGlobArray(frontmatter['applyTo']);
    return {
      globs: applyTo.length ? applyTo : ['**'],
      loading: applyTo.length ? 'auto-attached' : 'always',
      dirBoundary,
    };
  }

  // agents / claude / windsurf / cline / unknown → 디렉토리 경계 전역, always 로딩
  return { globs: [dirGlob(relDir)], loading: 'always', dirBoundary };
}
