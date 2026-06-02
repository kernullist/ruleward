import type { AnalysisContext } from '../context';
import type { Instruction, CodeReferent } from '../../types';
import { type Diagnostic, fingerprint } from '../../diagnostics';

/** drift 엔진 — Rule→Code 결정론 검사 (dangling/stale/broken). DEEP-DIVE §C.3. */

const SRC_DIRS = new Set([
  'src', 'lib', 'app', 'test', 'tests', 'packages', 'dist', 'build', 'components',
  'pages', 'scripts', 'config', 'public', 'assets', 'server', 'client', 'api',
  'docs', 'types', 'utils', 'core', 'modules', 'styles', 'hooks', 'services',
  'routes', 'controllers', 'models',
]);
const PM_HEAD = /^(npm|pnpm|yarn|npx)$/;
const PM_BUILTIN = new Set([
  'install', 'i', 'ci', 'add', 'remove', 'rm', 'update', 'up', 'run', 'exec',
  'dlx', 'create', 'init', 'publish', 'pack', 'link', 'audit', 'outdated',
  'why', 'dedupe', 'store', 'test', 'start', 'help',
]);

// stale-symbol 오탐 억제용 전역/빌트인 PascalCase 식별자 denylist.
const BUILTIN_SYMBOLS = new Set([
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Function', 'Promise',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Date', 'RegExp', 'JSON', 'Math', 'Reflect', 'Proxy',
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'EvalError', 'URIError', 'AggregateError',
  'ArrayBuffer', 'SharedArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
  'Buffer', 'Blob', 'File', 'FormData', 'URL', 'URLSearchParams', 'Request', 'Response', 'Headers',
  'Event', 'EventTarget', 'AbortController', 'AbortSignal', 'TextEncoder', 'TextDecoder',
  'Console', 'Intl', 'Atomics', 'WebSocket', 'Worker', 'Iterator', 'Generator', 'AsyncGenerator',
]);

function looksLikePath(p: string): boolean {
  if (/^(\.\.?\/|\/|~\/)/.test(p)) return true;
  if (/\.\w{1,6}(\/|$)/.test(p)) return true;
  const seg = p.split('/').filter(Boolean);
  if (seg.length >= 3) return true;
  if (seg.length >= 2 && SRC_DIRS.has(seg[0]!)) return true;
  return false;
}

function pathBase(value: string): string {
  const star = value.indexOf('*');
  const head = star >= 0 ? value.slice(0, star) : value;
  return head.replace(/[#?].*$/, '').replace(/\/+$/, '');
}

function isDangling(value: string, ctx: AnalysisContext): boolean {
  if (/^[a-z]+:\/\//i.test(value)) return false;
  if (!value.includes('/')) return false; // 디렉토리 없는 맨 파일명은 어디에든 있을 수 있어 보류(FP 방지)
  if (!looksLikePath(value)) return false;
  const base = pathBase(value);
  if (!base || base === '.' || base === '..') return false;
  return !ctx.exists(base);
}

function aliasStatus(value: string, ctx: AnalysisContext): 'ok' | 'broken' {
  const c = ctx.config;
  if (!c.hasTsconfig && c.deps.size === 0) return 'ok'; // 검증 불가 → 보류
  const scope = value.split('/')[0] ?? value;
  if (c.tsAliasScopes.includes(scope)) return 'ok';
  if (c.tsAliases.some((a) => (a.split('/')[0] ?? a) === scope)) return 'ok';
  if ([...c.deps].some((d) => d === scope || d.startsWith(`${scope}/`))) return 'ok';
  return 'broken';
}

function parseScript(cmd: string): string | null {
  const parts = cmd.trim().split(/\s+/);
  if (!PM_HEAD.test(parts[0] ?? '')) return null;
  const rest = parts.slice(1);
  if (rest[0] === 'run') return rest[1] ?? null;
  return rest[0] ?? null;
}

function danglingDiag(ins: Instruction, ref: CodeReferent): Diagnostic {
  return {
    checkId: 'drift/dangling-path',
    engine: 'drift',
    severity: 'warning',
    confidence: 0.85,
    message: `룰이 가리키는 경로 '${ref.value}'가 존재하지 않음`,
    location: { file: ins.source.file, line: ins.source.line },
    fix: { kind: 'manual', description: '경로를 현재 구조에 맞게 수정하거나 룰 제거' },
    fingerprint: fingerprint(['drift/dangling-path', ins.id, ref.value]),
  };
}

function brokenAliasDiag(ins: Instruction, ref: CodeReferent): Diagnostic {
  return {
    checkId: 'drift/broken-alias',
    engine: 'drift',
    severity: 'warning',
    confidence: 0.8,
    message: `별칭 '${ref.value}'가 tsconfig paths/의존성에 없음`,
    location: { file: ins.source.file, line: ins.source.line },
    fix: { kind: 'manual', description: 'tsconfig paths에 별칭 추가 또는 룰 수정' },
    fingerprint: fingerprint(['drift/broken-alias', ins.id, ref.value]),
  };
}

function staleCmdDiag(ins: Instruction, ref: CodeReferent, script: string): Diagnostic {
  return {
    checkId: 'drift/stale-command',
    engine: 'drift',
    severity: 'error',
    confidence: 0.9,
    message: `명령 '${ref.value}'의 스크립트 '${script}'가 package.json scripts에 없음`,
    location: { file: ins.source.file, line: ins.source.line },
    fix: { kind: 'manual', description: `package.json에 '${script}' 스크립트 추가 또는 룰 수정` },
    fingerprint: fingerprint(['drift/stale-command', ins.id, script]),
  };
}

function staleDepDiag(ins: Instruction, value: string): Diagnostic {
  return {
    checkId: 'drift/stale-dependency',
    engine: 'drift',
    severity: 'warning',
    confidence: 0.8,
    message: `룰이 '${value}' 사용을 명시하지만 의존성에 설치돼 있지 않음`,
    location: { file: ins.source.file, line: ins.source.line },
    fix: { kind: 'manual', description: `'${value}' 설치 또는 룰 수정` },
    fingerprint: fingerprint(['drift/stale-dependency', ins.id, value]),
  };
}

function staleSymbolBase(value: string): string {
  const head = value.split('.')[0] ?? value;
  return head.split('<')[0] ?? head;
}

/** 룰이 참조하는 심볼이 코드베이스에 없는가. PascalCase + 인덱스 존재 시에만(고FP 억제). */
function isStaleSymbol(value: string, ctx: AnalysisContext): boolean {
  const idx = ctx.codeIndex;
  if (!idx || idx.declaredNames.size === 0) return false; // 인덱스 없음 → 검증 불가 → 보류
  const base = staleSymbolBase(value);
  if (!/^[A-Z][A-Za-z0-9]*$/.test(base)) return false; // PascalCase 한정
  if (BUILTIN_SYMBOLS.has(base)) return false;
  if (idx.declaredNames.has(base)) return false;
  for (const d of ctx.config.deps) {
    if (d === base || d.startsWith(`${base}/`) || d.endsWith(`/${base}`)) return false;
  }
  return true;
}

function staleSymbolDiag(ins: Instruction, ref: CodeReferent): Diagnostic {
  return {
    checkId: 'drift/stale-symbol',
    engine: 'drift',
    severity: 'warning',
    confidence: 0.6,
    message: `룰이 참조하는 심볼 \`${ref.value}\`를 코드베이스에서 찾을 수 없음(이름 변경·삭제 가능)`,
    location: { file: ins.source.file, line: ins.source.line },
    fix: { kind: 'manual', description: '심볼명을 현재 코드에 맞게 수정하거나 룰 제거' },
    fingerprint: fingerprint(['drift/stale-symbol', ins.id, ref.value]),
  };
}

export function checkDrift(ctx: AnalysisContext): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const ins of ctx.instructions) {
    for (const ref of ins.codeReferents) {
      if (ref.kind === 'path' && ref.confidence >= 0.8) {
        if (isDangling(ref.value, ctx)) out.push(danglingDiag(ins, ref));
      } else if (ref.kind === 'alias') {
        if (aliasStatus(ref.value, ctx) === 'broken') out.push(brokenAliasDiag(ins, ref));
      } else if (ref.kind === 'command' && ctx.config.scripts.size > 0) {
        const script = parseScript(ref.value);
        if (script && !PM_BUILTIN.has(script) && !ctx.config.scripts.has(script)) {
          out.push(staleCmdDiag(ins, ref, script));
        }
      } else if (ref.kind === 'symbol' && ref.confidence >= 0.7) {
        if (isStaleSymbol(ref.value, ctx)) out.push(staleSymbolDiag(ins, ref));
      }
    }

    const kv = ins.settingKV;
    if (
      kv &&
      ctx.config.hasPackageJson &&
      ctx.config.deps.size > 0 &&
      (kv.key === 'testing.framework' || kv.key === 'logging.framework')
    ) {
      const dep = kv.value.toLowerCase();
      const present = [...ctx.config.deps].some((d) => {
        const dl = d.toLowerCase();
        return dl === dep || dl.endsWith(`/${dep}`) || dl.includes(dep);
      });
      if (!present) out.push(staleDepDiag(ins, kv.value));
    }
  }
  return out;
}
