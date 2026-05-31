import type { Directive, Polarity } from '../types';

/**
 * Modality 사전 v1 (FROZEN §4). directive/polarity 추출.
 *
 * 2축 모델: (1) polarity 트리거(부정/금지어) (2) strength 트리거(must/should-level).
 * 부정어가 polarity를 뒤집고, strength가 등급을 정한다. 사전 최강 매칭 우선.
 * en은 단어경계 정규식, ko는 부분문자열(교착어). 입력은 소문자화 — 한국어엔 영향 없음.
 */

const PROHIBITION: RegExp[] = [
  /\bnever\b/,
  /\bmust\s?n['’]?t\b/,
  /\bmust not\b/,
  /\bdo not\b/,
  /\bdo\s?n['’]?t\b/,
  /\bdoes\s?n['’]?t\b/,
  /\bcannot\b/,
  /\bcan\s?n['’]?t\b/,
  /\bshould\s?n['’]?t\b/,
  /\bshould not\b/,
  /\bforbidden\b/,
  /\bprohibit(ed)?\b/,
  /\bdisallow(ed)?\b/,
  /\bnot allowed\b/,
  /\bavoid\b/,
  /\bdiscourag(e|ed)\b/,
  /\btry not\b/,
  /^no\s+\w+/, // "No default exports", "No var"
  /금지/,
  /하지\s?마/,
  /지\s?마라/,
  /말\s?것/,
  /지양/,
  /피하/,
  /안\s?된다/,
  /안\s?돼/,
];

const STRONG: RegExp[] = [
  /\bmust\b/,
  /\balways\b/,
  /\bnever\b/,
  /\brequire(d|s)?\b/,
  /\bshall\b/,
  /\bneed to\b/,
  /\bhave to\b/,
  /\bmandatory\b/,
  /\bensure\b/,
  /\bforbidden\b/,
  /\bprohibit(ed)?\b/,
  /\bdisallow(ed)?\b/,
  /\bdo not\b/,
  /\bdo\s?n['’]?t\b/,
  /\bcannot\b/,
  /\bcan\s?n['’]?t\b/,
  /반드시/,
  /항상/,
  /필수/,
  /무조건/,
  /해야/,
  /절대/,
  /금지/,
  /하지\s?마/,
  /지\s?마라/,
  /말\s?것/,
];

const SOFT: RegExp[] = [
  /\bshould\b/,
  /\bprefer(red|s)?\b/,
  /\brecommend(ed)?\b/,
  /\bencourag(e|ed)\b/,
  /\bideally\b/,
  /\bfavor\b/,
  /\bavoid\b/,
  /\bdiscourag(e|ed)\b/,
  /\btry not\b/,
  /권장/,
  /좋다/,
  /좋습니다/,
  /지향/,
  /가급적/,
  /선호/,
  /피하/,
  /바람직/,
];

const MAYS: RegExp[] = [
  /\bmay\b/,
  /\bcan\b/,
  /\boptional(ly)?\b/,
  /\bfeel free\b/,
  /\bif needed\b/,
  /\bif necessary\b/,
  /해도\s?된다/,
  /선택/,
  /필요하면/,
  /무방/,
];

/** SOFT 매칭이 preference(선호류)인지 — 아니면 requirement(should/약). */
const PREFERENCE: RegExp[] = [
  /\bprefer/,
  /\brecommend/,
  /\bencourag/,
  /\bideally\b/,
  /\bfavor\b/,
  /권장/,
  /선호/,
  /지향/,
  /가급적/,
  /좋다/,
  /바람직/,
];

const IMPERATIVE_VERBS = new Set([
  'use', 'write', 'run', 'add', 'remove', 'keep', 'follow', 'ensure', 'prefer',
  'avoid', 'make', 'create', 'import', 'export', 'name', 'place', 'put', 'define',
  'return', 'handle', 'document', 'test', 'commit', 'format', 'lint', 'validate',
  'store', 'throw', 'wrap', 'split', 'group', 'sort', 'pin', 'update', 'install',
  'configure', 'set', 'enable', 'disable', 'check', 'verify', 'log', 'catch',
  'mock', 'stub', 'apply', 'extend', 'implement', 'replace', 'rename', 'delete',
  'inject', 'register', 'expose', 'limit', 'restrict', 'escape', 'sanitize',
]);

const KO_IMPERATIVE_ENDINGS = ['마라', '말 것', '하라', '해라', '하세요', '할 것', '하자', '쓰라', '두라'];

function anyMatch(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/** 명령문 여부 휴리스틱 (en: 동사로 시작 / ko: 명령형 종결). */
export function isImperative(text: string): boolean {
  const trimmed = text.trim();
  const firstWord = trimmed.replace(/^[^A-Za-z가-힣]+/, '').split(/[\s,;:.]/)[0]?.toLowerCase() ?? '';
  if (IMPERATIVE_VERBS.has(firstWord)) return true;
  const noPunct = trimmed.replace(/[.!?。·\s]+$/, '');
  return KO_IMPERATIVE_ENDINGS.some((e) => noPunct.endsWith(e));
}

export function detectDirective(text: string): { directive: Directive; polarity: Polarity } {
  const t = ` ${text.toLowerCase()} `;

  const hasProhibition = anyMatch(t, PROHIBITION);
  const hasStrong = anyMatch(t, STRONG);
  const hasSoft = anyMatch(t, SOFT);
  const hasMay = anyMatch(t, MAYS);

  if (hasProhibition) {
    return { directive: hasStrong ? 'MUST_NOT' : 'SHOULD_NOT', polarity: 'prohibition' };
  }
  if (hasStrong) return { directive: 'MUST', polarity: 'requirement' };
  if (hasSoft) {
    const pref = anyMatch(t, PREFERENCE);
    return { directive: 'SHOULD', polarity: pref ? 'preference' : 'requirement' };
  }
  if (hasMay) return { directive: 'MAY', polarity: 'preference' };
  if (isImperative(text)) return { directive: 'SHOULD', polarity: 'requirement' };
  return { directive: 'INFO', polarity: 'statement' };
}
