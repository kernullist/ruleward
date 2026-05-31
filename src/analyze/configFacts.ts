import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** 설정 파일에서 fact 추출 (중복 visibility check + 드리프트 입력 · DEEP-DIVE §6.2). */

export interface ConfigFacts {
  hasPackageJson: boolean;
  hasTsconfig: boolean;
  language?: 'typescript' | 'javascript';
  deps: Set<string>;
  scripts: Set<string>;
  packageManager?: string;
  tsAliases: string[]; // tsconfig paths 키 원본
  tsAliasScopes: string[]; // 키의 첫 세그먼트 (예: "@core")
  style: Record<string, string>; // style.indent, style.indentSize, style.quotes, style.semicolons
}

function emptyFacts(): ConfigFacts {
  return {
    hasPackageJson: false,
    hasTsconfig: false,
    deps: new Set(),
    scripts: new Set(),
    tsAliases: [],
    tsAliasScopes: [],
    style: {},
  };
}

/** 관대한 JSONC 파싱(주석·트레일링 콤마 허용). */
function parseJsonc(text: string): Record<string, unknown> {
  const cleaned = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(cleaned) as Record<string, unknown>;
}

function applyPrettier(p: Record<string, unknown>, facts: ConfigFacts): void {
  if (p['useTabs'] === true) facts.style['style.indent'] = 'tab';
  else if (p['useTabs'] === false) facts.style['style.indent'] = 'space';
  if (typeof p['tabWidth'] === 'number') facts.style['style.indentSize'] = String(p['tabWidth']);
  if (p['singleQuote'] === true) facts.style['style.quotes'] = 'single';
  else if (p['singleQuote'] === false) facts.style['style.quotes'] = 'double';
  if (p['semi'] === false) facts.style['style.semicolons'] = 'forbidden';
  else if (p['semi'] === true) facts.style['style.semicolons'] = 'required';
}

function applyEditorConfig(text: string, facts: ConfigFacts): void {
  const m1 = text.match(/indent_style\s*=\s*(tab|space)/i);
  if (m1?.[1]) facts.style['style.indent'] = m1[1].toLowerCase();
  const m2 = text.match(/indent_size\s*=\s*(\d+)/i);
  if (m2?.[1]) facts.style['style.indentSize'] = m2[1];
  const m3 = text.match(/quote_type\s*=\s*(single|double)/i);
  if (m3?.[1]) facts.style['style.quotes'] = m3[1].toLowerCase();
}

async function tryRead(p: string): Promise<string | null> {
  try {
    return await readFile(p, 'utf-8');
  } catch {
    return null;
  }
}

export async function extractConfigFacts(root: string): Promise<ConfigFacts> {
  const facts = emptyFacts();

  // package.json
  const pkgRaw = await tryRead(path.join(root, 'package.json'));
  if (pkgRaw) {
    try {
      const pkg = parseJsonc(pkgRaw);
      facts.hasPackageJson = true;
      const collect = (k: string): void => {
        const obj = pkg[k];
        if (obj && typeof obj === 'object') for (const name of Object.keys(obj)) facts.deps.add(name);
      };
      collect('dependencies');
      collect('devDependencies');
      collect('peerDependencies');
      const scripts = pkg['scripts'];
      if (scripts && typeof scripts === 'object') for (const s of Object.keys(scripts)) facts.scripts.add(s);
      if (typeof pkg['packageManager'] === 'string') facts.packageManager = pkg['packageManager'].split('@')[0];
      if (pkg['prettier'] && typeof pkg['prettier'] === 'object') applyPrettier(pkg['prettier'] as Record<string, unknown>, facts);
    } catch {
      facts.hasPackageJson = true; // 존재하나 파싱 실패
    }
  }

  // 락파일 기반 패키지 매니저
  if (!facts.packageManager) {
    if (existsSync(path.join(root, 'pnpm-lock.yaml'))) facts.packageManager = 'pnpm';
    else if (existsSync(path.join(root, 'yarn.lock'))) facts.packageManager = 'yarn';
    else if (existsSync(path.join(root, 'bun.lockb'))) facts.packageManager = 'bun';
    else if (existsSync(path.join(root, 'package-lock.json'))) facts.packageManager = 'npm';
  }

  // tsconfig
  for (const tc of ['tsconfig.json', 'tsconfig.base.json']) {
    const raw = await tryRead(path.join(root, tc));
    if (!raw) continue;
    facts.hasTsconfig = true;
    try {
      const ts = parseJsonc(raw);
      const co = ts['compilerOptions'];
      const paths = co && typeof co === 'object' ? (co as Record<string, unknown>)['paths'] : undefined;
      if (paths && typeof paths === 'object') {
        for (const key of Object.keys(paths)) {
          facts.tsAliases.push(key);
          const scope = key.split('/')[0] ?? key;
          if (!facts.tsAliasScopes.includes(scope)) facts.tsAliasScopes.push(scope);
        }
      }
    } catch {
      /* tsconfig 파싱 실패는 무시 */
    }
  }

  facts.language = facts.hasTsconfig ? 'typescript' : facts.hasPackageJson ? 'javascript' : undefined;

  // prettier / editorconfig
  for (const pf of ['.prettierrc', '.prettierrc.json']) {
    const raw = await tryRead(path.join(root, pf));
    if (raw) {
      try {
        applyPrettier(parseJsonc(raw), facts);
      } catch {
        /* ignore */
      }
    }
  }
  const ec = await tryRead(path.join(root, '.editorconfig'));
  if (ec) applyEditorConfig(ec, facts);

  return facts;
}
