import { createRequire } from 'node:module';
import { type CodeSymbol, parseReplacement } from './scan';

/**
 * tree-sitter 정밀 deprecation 스캐너 (DEEP-DIVE §C.4).
 * web-tree-sitter@0.22 (default-export API) + tree-sitter-wasms 문법.
 * 로딩/파싱 실패는 모두 null 반환 → 호출부가 정규식 폴백.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type TsParser = any;

interface TsPool {
  parsers: Map<string, TsParser>;
}

const EXT_GRAMMAR: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
};

const DECL_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_definition',
  'class_declaration',
  'class_definition',
  'abstract_class_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'lexical_declaration',
  'variable_declaration',
  'method_definition',
  'public_field_definition',
  'type_declaration',
  'method_declaration',
  'const_declaration',
  'var_declaration',
]);

let poolPromise: Promise<TsPool | null> | null = null;

async function initPool(): Promise<TsPool | null> {
  try {
    const require = createRequire(import.meta.url);
    const mod: any = await import('web-tree-sitter');
    const Parser = mod.default ?? mod;
    const runtime = require.resolve('web-tree-sitter/tree-sitter.wasm');
    await Parser.init({ locateFile: (f: string) => (f.endsWith('.wasm') ? runtime : f) });

    const parsers = new Map<string, TsParser>();
    const langCache = new Map<string, any>();
    for (const [ext, gname] of Object.entries(EXT_GRAMMAR)) {
      try {
        let lang = langCache.get(gname);
        if (!lang) {
          const wasm = require.resolve(`tree-sitter-wasms/out/tree-sitter-${gname}.wasm`);
          lang = await Parser.Language.load(wasm);
          langCache.set(gname, lang);
        }
        const p = new Parser();
        p.setLanguage(lang);
        parsers.set(ext, p);
      } catch {
        /* 이 문법만 스킵 */
      }
    }
    return parsers.size > 0 ? { parsers } : null;
  } catch {
    return null;
  }
}

/** 메모이즈된 런타임. tree-sitter 미가용 시 null. */
export function getRuntime(): Promise<TsPool | null> {
  if (!poolPromise) poolPromise = initPool();
  return poolPromise;
}

function noteFromComment(text: string, ext: string): string | null {
  let m = text.match(/@deprecated\b[:\s]*([^\n*]*)/i);
  if (m) return (m[1] ?? '').trim();
  if (ext === 'go') {
    m = text.match(/Deprecated:\s*([^\n]*)/);
    if (m) return (m[1] ?? '').trim();
  }
  if (ext === 'py') {
    m = text.match(/Deprecated[:\s]*([^\n]*)/i);
    if (m) return (m[1] ?? '').trim();
  }
  return null;
}

function declName(node: any): string | null {
  if (!node) return null;
  if (node.type === 'export_statement' || node.type === 'decorated_definition') {
    for (const c of node.namedChildren ?? []) {
      if (DECL_TYPES.has(c.type)) {
        const n = declName(c);
        if (n) return n;
      }
    }
  }
  const nameNode = node.childForFieldName?.('name');
  if (nameNode?.text) return nameNode.text;
  for (const c of node.namedChildren ?? []) {
    if (c.type === 'variable_declarator') {
      const n = c.childForFieldName?.('name');
      if (n?.text) return n.text;
    }
    if (/^(identifier|type_identifier|property_identifier)$/.test(c.type) && c.text) return c.text;
  }
  return null;
}

/** 주석 다음에 오는 선언 노드(주석/데코레이터는 건너뜀). 비선언이면 null → 오귀속 방지. */
function declAfter(node: any): any | null {
  let n = node.nextNamedSibling;
  let hops = 0;
  while (n && hops < 5) {
    if (n.type === 'comment' || n.type === 'decorator') {
      n = n.nextNamedSibling;
      hops++;
      continue;
    }
    if (DECL_TYPES.has(n.type) || n.type === 'export_statement' || n.type === 'decorated_definition') return n;
    return null;
  }
  return null;
}

function extOf(file: string): string {
  return (file.split('.').pop() ?? '').toLowerCase();
}

/** 지원 ext면 CodeSymbol[](없으면 []), 미지원/파싱실패면 null(→ 정규식 폴백). */
export function scanWithRuntime(pool: TsPool, content: string, file: string): CodeSymbol[] | null {
  const ext = extOf(file);
  const parser = pool.parsers.get(ext);
  if (!parser) return null;

  try {
    const tree = parser.parse(content);
    if (!tree) return null;
    const root = tree.rootNode;
    const out: CodeSymbol[] = [];
    const seen = new Set<string>();
    const push = (name: string, line: number, note: string): void => {
      const key = `${name}:${line}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name, file, line, deprecated: true, note: note || undefined, replacement: parseReplacement(note) });
    };

    for (const c of root.descendantsOfType('comment')) {
      const note = noteFromComment(c.text, ext);
      if (note === null) continue;
      const decl = declAfter(c);
      const name = decl ? declName(decl) : null;
      if (name) push(name, (decl.startPosition?.row ?? 0) + 1, note);
    }

    if (ext === 'py') {
      for (const dec of root.descendantsOfType('decorator')) {
        if (!/\bdeprecated\b/i.test(dec.text)) continue;
        const dd = dec.parent;
        const name = dd ? declName(dd) : null;
        if (name) push(name, (dd?.startPosition?.row ?? 0) + 1, '');
      }
    }

    return out;
  } catch {
    return null;
  }
}
