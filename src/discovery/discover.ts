import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import matter from 'gray-matter';
import type { FileFormat, RuleFile } from '../types';
import { fileScope } from '../extract/scope';

/** 멀티포맷 룰파일 탐색 + RuleFile 구성 (파이프라인 ① Discovery). */

const PATTERNS = [
  '**/AGENTS.md',
  '**/CLAUDE.md',
  '**/.cursor/rules/**/*.mdc',
  '.cursor/rules/**/*.mdc',
  '.github/copilot-instructions.md',
  '.github/**/*.instructions.md',
  '**/.windsurfrules',
  '**/.clinerules',
];

const IGNORE = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/coverage/**'];

function formatFromPath(rel: string): FileFormat {
  const base = path.basename(rel).toLowerCase();
  if (rel.toLowerCase().endsWith('.mdc')) return 'cursor-mdc';
  if (base === 'agents.md') return 'agents';
  if (base === 'claude.md') return 'claude';
  if (base === 'copilot-instructions.md' || base.endsWith('.instructions.md')) return 'copilot';
  if (base === '.windsurfrules') return 'windsurf';
  if (base === '.clinerules') return 'cline';
  return 'unknown';
}

function buildRuleFile(root: string, rel: string, content: string): RuleFile {
  const relPath = rel.replace(/\\/g, '/');
  const fm = matter(content);
  const format = formatFromPath(relPath);
  const data = (fm.data ?? {}) as Record<string, unknown>;
  const relDir = path.dirname(relPath) === '.' ? '' : path.dirname(relPath);
  return {
    relPath,
    absPath: path.resolve(root, rel),
    format,
    frontmatter: data,
    body: fm.content ?? '',
    scope: fileScope(format, data, relDir),
  };
}

export async function discover(root: string, ignore: string[] = []): Promise<RuleFile[]> {
  const rels = await glob(PATTERNS, { cwd: root, ignore: [...IGNORE, ...ignore], dot: true, absolute: false });
  const unique = [...new Set(rels)].sort();
  const files: RuleFile[] = [];
  for (const rel of unique) {
    let content: string;
    try {
      content = await readFile(path.resolve(root, rel), 'utf-8');
    } catch {
      continue;
    }
    files.push(buildRuleFile(root, rel, content));
  }
  return files;
}

/** 단일 파일 로드(CLI용). */
export async function loadFile(filePath: string, root: string = process.cwd()): Promise<RuleFile> {
  const absPath = path.resolve(filePath);
  const content = await readFile(absPath, 'utf-8');
  const rel = path.relative(root, absPath) || path.basename(absPath);
  return buildRuleFile(root, rel, content);
}
