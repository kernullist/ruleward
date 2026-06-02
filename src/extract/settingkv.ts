import type { SettingKV, SettingConfType } from '../types';

/**
 * settingKV 온톨로지 v1 (FROZEN §3) — "키-값으로 환원 가능한 룰"을 정규 키로 매핑.
 * 데이터 주도: 매처 배열에 행 추가만으로 키 확장. 첫 매칭 반환(우선순위 = 배열 순서).
 */

interface MatchResult {
  value: string;
  /** 동적 키(예: naming.case.<target>). 없으면 Matcher.key 사용. */
  key?: string;
}

interface Matcher {
  key: string;
  confType: SettingConfType;
  /** 소문자 정규화 텍스트에서 매칭. */
  test: (lower: string) => MatchResult | null;
}

function kv(key: string, confType: SettingConfType, test: Matcher['test']): Matcher {
  return { key, confType, test };
}

const NAMING_CASES = /(camelcase|camel case|snake_case|snake case|pascalcase|pascal case|kebab-case|kebab case|screaming_snake)/;
const NAMING_TARGETS: Array<[RegExp, string]> = [
  [/\b(variables?|vars?)\b|변수/, 'variable'],
  [/\b(functions?)\b|함수/, 'function'],
  [/\b(classes|class)\b|클래스/, 'class'],
  [/\b(file ?names?|files?)\b|파일/, 'file'],
  [/\b(constants?)\b|상수/, 'constant'],
  [/\b(types?)\b|타입/, 'type'],
];

function caseToken(s: string): string {
  return s.replace(/[\s_-]/g, '').replace(/case$/, '');
}

// import 대상으로 잡히면 안 되는 일반 단어(실세계 FP: "from module" → 'module').
const GENERIC_IMPORT = new Set([
  'module', 'modules', 'package', 'packages', 'dependency', 'dependencies', 'library', 'libraries',
  'file', 'files', 'code', 'import', 'imports', 'the', 'them', 'this', 'that', 'it', 'anything',
  'everything', 'stuff', 'things', 'here', 'there', 'above', 'below', 'source', 'src',
]);

const MATCHERS: Matcher[] = [
  // --- style ---
  kv('style.indent', 'closed', (s) => {
    if (/들여|\bindent/.test(s) || /\buse (tabs?|spaces?)\b/.test(s)) {
      if (/\btabs?\b|탭/.test(s)) return { value: 'tab' };
      if (/\bspaces?\b|스페이스|공백/.test(s)) return { value: 'space' };
    }
    return null;
  }),
  kv('style.indentSize', 'scalar', (s) => {
    const m = s.match(/(\d+)[\s-]?(?:space|spaces|칸)|(?:indent|들여(?:쓰기)?)\D{0,8}(\d+)/);
    const n = m?.[1] ?? m?.[2];
    return n ? { value: n } : null;
  }),
  kv('style.quotes', 'closed', (s) => {
    if (/single quotes?|작은따옴표|홑따옴표/.test(s)) return { value: 'single' };
    if (/double quotes?|큰따옴표|쌍따옴표/.test(s)) return { value: 'double' };
    return null;
  }),
  kv('style.semicolons', 'closed', (s) => {
    if (/no semicolons?|without semicolons?|세미콜론.*(없|금지|말|생략)/.test(s)) return { value: 'forbidden' };
    if (/(require|use|always).{0,12}semicolons?|세미콜론.*(필수|사용|붙)/.test(s)) return { value: 'required' };
    return null;
  }),
  kv('style.lineLength', 'scalar', (s) => {
    const m = s.match(/(?:max(?:imum)?|line length|한\s?줄)\D{0,14}(\d{2,3})|(\d{2,3})\s*(?:chars|characters|columns|cols|자)\b/);
    const n = m?.[1] ?? m?.[2];
    return n ? { value: n } : null;
  }),
  kv('style.trailingComma', 'closed', (s) => {
    if (/trailing comma|후행\s?쉼표|끝\s?쉼표/.test(s)) {
      if (/\bno\b|없|금지|말/.test(s)) return { value: 'none' };
      return { value: 'all' };
    }
    return null;
  }),
  // --- naming ---
  kv('naming.case.any', 'closed', (s) => {
    const cm = s.match(NAMING_CASES);
    if (!cm) return null;
    let target = 'any';
    for (const [re, t] of NAMING_TARGETS) {
      if (re.test(s)) {
        target = t;
        break;
      }
    }
    return { value: caseToken(cm[1] ?? ''), key: `naming.case.${target}` };
  }),
  // --- imports / architecture ---
  kv('imports.restricted', 'set', (s) => {
    if (!/import/.test(s)) return null;
    if (!/(do\s?n['’]?t|never|avoid|\bno\b|금지|하지\s?마|말 것|restricted?)/.test(s)) return null;
    const m = s.match(/import\s+(?:from\s+)?[`'"]?([\w@./*-]+)[`'"]?|from\s+[`'"]?([\w@./*-]+)/);
    const v = (m?.[1] ?? m?.[2] ?? '').replace(/[^\w@/*-]+$/, ''); // 끝 구두점 제거('module.'→'module')
    return v && !GENERIC_IMPORT.has(v.toLowerCase()) ? { value: v } : null;
  }),
  kv('imports.preferred', 'set', (s) => {
    if (!/import/.test(s)) return null;
    if (/(do\s?n['’]?t|never|avoid|\bno\b|금지|하지\s?마|말 것)/.test(s)) return null;
    if (!/(use|prefer|always|from|via)/.test(s)) return null;
    const m = s.match(/import\s+(?:from\s+)?[`'"]?([\w@./*-]+)[`'"]?|from\s+[`'"]?([\w@./*-]+)/);
    const v = (m?.[1] ?? m?.[2] ?? '').replace(/[^\w@/*-]+$/, ''); // 끝 구두점 제거('module.'→'module')
    return v && !GENERIC_IMPORT.has(v.toLowerCase()) ? { value: v } : null;
  }),
  kv('imports.style', 'closed', (s) => {
    if (/named imports? only|only named imports?|named import만/.test(s)) return { value: 'named' };
    if (/no default exports?|default export.*(금지|말|\bno\b)/.test(s)) return { value: 'named' };
    if (/default exports?.*(use|prefer|선호)/.test(s)) return { value: 'default' };
    return null;
  }),
  // --- testing ---
  // 'set' — 한 프로젝트가 여러 테스트 도구(unit+e2e)를 쓰는 게 정상이라 충돌로 보지 않음.
  kv('testing.framework', 'set', (s) => {
    const m = s.match(/\b(jest|vitest|mocha|jasmine|pytest|unittest|junit|rspec|playwright|cypress)\b/);
    if (m && /(test|spec|테스트|use|with|run)/.test(s)) return { value: m[1] ?? '' };
    return null;
  }),
  kv('testing.location', 'closed', (s) => {
    if (/test/.test(s) && /co-?located|next to (the )?source|alongside|옆에|같은\s?(폴더|디렉)/.test(s)) return { value: 'colocated' };
    if (/__tests__|separate (test )?(dir|folder)|별도.*(테스트|폴더)/.test(s)) return { value: 'separate' };
    return null;
  }),
  // --- language / runtime ---
  kv('packageManager', 'closed', (s) => {
    const m = s.match(/\b(npm|yarn|pnpm|bun)\b/);
    if (m && /(use|run|install|package manager|패키지\s?매니저|로 설치)/.test(s)) return { value: m[1] ?? '' };
    return null;
  }),
  // 언어별 키로 분리 — 'typescript5.6' vs 'node24'는 서로 다른 것이라 충돌이 아님.
  kv('lang.version', 'singleton', (s) => {
    const m = s.match(/\b(es20\d\d|esnext|python\s?3\.\d+|node\s?\d+|java\s?\d+|typescript\s?\d\.\d)\b/);
    if (!m) return null;
    const v = (m[1] ?? '').replace(/\s+/g, '').toLowerCase();
    let lang = 'other';
    if (v.startsWith('typescript')) lang = 'typescript';
    else if (v.startsWith('python')) lang = 'python';
    else if (v.startsWith('node')) lang = 'node';
    else if (v.startsWith('java')) lang = 'java';
    else if (v.startsWith('es')) lang = 'ecmascript';
    return { value: v, key: `lang.version.${lang}` };
  }),
  // --- patterns ---
  kv('async.style', 'closed', (s) => {
    if (/async\/await|async await/.test(s)) return { value: 'asyncAwait' };
    if (/\.then\(|raw promises?|프로미스 체인/.test(s)) return { value: 'promises' };
    if (/\bcallbacks?\b|콜백/.test(s)) return { value: 'callbacks' };
    return null;
  }),
  kv('commit.format', 'singleton', (s) => {
    if (/conventional commits?|컨벤셔널 커밋/.test(s)) return { value: 'conventional' };
    return null;
  }),
];

export function matchSettingKV(normalizedLower: string): SettingKV | null {
  const s = normalizedLower.toLowerCase();
  for (const m of MATCHERS) {
    const r = m.test(s);
    if (r) {
      return { key: r.key ?? m.key, value: r.value, confType: m.confType };
    }
  }
  return null;
}
