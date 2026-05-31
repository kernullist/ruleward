import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { getRuntime, scanWithRuntime } from './treesitter';

/**
 * 코드 인덱스 v1 — deprecation 디텍터 (DEEP-DIVE §C.4).
 * Phase 1 부트스트랩은 라인 지향 정규식 스캐너(마커가 라인 지향이라 안정적). tree-sitter 정밀화는 후속.
 */

export interface CodeSymbol {
  name: string;
  file: string;
  line: number;
  deprecated: boolean;
  note?: string;
  replacement?: string;
}

export interface CodeIndex {
  deprecated: CodeSymbol[];
  declaredNames: Set<string>; // 코드베이스의 모든 선언 식별자 (stale-symbol 검사용; tree-sitter 인덱싱 시에만 채워짐)
  fileCount: number;
}

const CODE_GLOBS = ['**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,java,cs,rs}'];
const IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/*.d.ts',
  '**/*.min.js',
];
const MAX_FILES = 4000;
const FAST_SKIP = /@deprecated|Deprecated:|\[Obsolete|#\[deprecated|DeprecationWarning/i;

/** 한 줄에서 폐기 마커를 찾고 노트(설명) 반환. 마커 없으면 null. */
function deprecationNote(line: string, ext: string): string | null {
  let m = line.match(/@deprecated\b[:\s]*(.*)$/i); // jsdoc/tsdoc/java 어노테이션/py 데코레이터
  if (m) {
    // 주석 또는 어노테이션/데코레이터 맥락에서만 인정 — 문자열 리터럴 속 "@deprecated" 오탐 방지.
    const before = line.slice(0, m.index ?? 0);
    if (/^\s*$/.test(before) || /\/\/|\/\*|\*|#/.test(before)) return (m[1] ?? '').trim();
  }
  if (ext === 'go') {
    m = line.match(/\/\/\s*Deprecated:\s*(.*)$/);
    if (m) return (m[1] ?? '').trim();
  }
  if (ext === 'rs') {
    m = line.match(/#\[deprecated(?:\([^)]*note\s*=\s*"([^"]*)"[^)]*\))?/);
    if (m) return (m[1] ?? '').trim();
  }
  if (ext === 'cs') {
    m = line.match(/\[Obsolete(?:\(\s*"([^"]*)")?/);
    if (m) return (m[1] ?? '').trim();
  }
  if (ext === 'py') {
    m = line.match(/#\s*Deprecated[:\s]*(.*)$/i);
    if (m) return (m[1] ?? '').trim();
    if (/DeprecationWarning/.test(line)) {
      const w = line.match(/warn\(\s*["']([^"']*)["']/);
      return (w?.[1] ?? '').trim();
    }
  }
  return null;
}

const DECL_RES: RegExp[] = [
  /\b(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /\b(?:export\s+)?(?:async\s+)?(?:function|func|fn)\s+([A-Za-z_$][\w$]*)/,
  /\bdef\s+([A-Za-z_$][\w$]*)/,
  /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
  /\b(?:export\s+)?(?:interface|type|struct|enum|trait)\s+([A-Za-z_$][\w$]*)/,
  /\b(?:public|private|protected|internal|static|virtual|override)\s+[\w<>[\],\s.]*?\b([A-Za-z_$][\w$]*)\s*\(/,
  /^\s*([A-Za-z_$][\w$]*)\s*[:(=]/,
];

const SKIP_LINE = /^\s*(?:\/\/|#(?!\[)|\*|\/\*|@|\[|#\[)/;

/** 마커 라인부터 아래로 선언 식별자 탐색. */
function findName(lines: string[], start: number): string | null {
  for (let i = start; i < Math.min(lines.length, start + 7); i++) {
    const ln = lines[i] ?? '';
    if (!ln.trim()) continue;
    if (i !== start && SKIP_LINE.test(ln)) continue;
    for (const re of DECL_RES) {
      const m = ln.match(re);
      if (m?.[1]) return m[1];
    }
  }
  return null;
}

export function parseReplacement(note: string | undefined): string | undefined {
  if (!note) return undefined;
  const pats = [
    /use\s+`?([\w.$]+)`?\s+instead/i,
    /replaced by\s+`?([\w.$]+)`?/i,
    /→\s*`?([\w.$]+)`?/,
    /대신\s+`?([\w.$]+)`?/,
  ];
  for (const p of pats) {
    const m = note.match(p);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/** 순수 함수: 파일 내용 → 폐기 심볼 목록 (단위 테스트 가능). */
export function scanText(content: string, file: string): CodeSymbol[] {
  const ext = (file.split('.').pop() ?? '').toLowerCase();
  const lines = content.split(/\r?\n/);
  const out: CodeSymbol[] = [];
  for (let i = 0; i < lines.length; i++) {
    const note = deprecationNote(lines[i] ?? '', ext);
    if (note === null) continue;
    const name = findName(lines, i);
    if (!name) continue;
    out.push({
      name,
      file,
      line: i + 1,
      deprecated: true,
      note: note || undefined,
      replacement: parseReplacement(note),
    });
  }
  return out;
}

export async function buildCodeIndex(root: string): Promise<CodeIndex> {
  const files = await glob(CODE_GLOBS, { cwd: root, ignore: IGNORE, dot: false, absolute: false });
  const capped = files.slice(0, MAX_FILES);
  const pool = await getRuntime(); // tree-sitter 풀(없으면 null → 정규식 폴백)
  const deprecated: CodeSymbol[] = [];
  const declaredNames = new Set<string>();
  for (const rel of capped) {
    let content: string;
    try {
      content = await readFile(path.resolve(root, rel), 'utf-8');
    } catch {
      continue;
    }
    if (content.length > 2_000_000) continue;
    const relUnix = rel.replace(/\\/g, '/');
    const r = pool ? scanWithRuntime(pool, content, relUnix) : null;
    if (r) {
      // tree-sitter: 지원 언어는 항상 파싱(폐기 + 선언 인덱스 수집)
      for (const s of r.deprecated) deprecated.push(s);
      for (const n of r.declared) declaredNames.add(n);
    } else if (FAST_SKIP.test(content)) {
      // 미지원 언어/파싱 실패 → 정규식 폴백(폐기 마커만, 선언 인덱스 없음)
      for (const s of scanText(content, relUnix)) deprecated.push(s);
    }
  }
  return { deprecated, declaredNames, fileCount: capped.length };
}
