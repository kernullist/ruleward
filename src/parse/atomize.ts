import { isImperative } from '../extract/modality';

/** 블록 → 원자 클로즈 분할 (DEEP-DIVE §A.1). 보수적: 뒤 절이 명령형일 때만 'and' 분리. */

const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;

export function normalize(text: string): string {
  return text.replace(LIST_MARKER, '').replace(/\s+/g, ' ').trim();
}

export function atomize(text: string): { clauses: string[]; compound: boolean } {
  const base = normalize(text);

  // 1차: 세미콜론 분할
  const parts = base
    .split(/\s*;\s+/)
    .map((p) => p.trim())
    .filter(Boolean);

  // 2차: 'and'로 이어진 독립 명령 분리 (뒤 절 전부가 명령형일 때만)
  const expanded: string[] = [];
  for (const p of parts) {
    const sub = p.split(/,?\s+and\s+/i).map((x) => x.trim());
    if (sub.length > 1 && sub.slice(1).every((x) => isImperative(x))) {
      expanded.push(...sub);
    } else {
      expanded.push(p);
    }
  }

  const clauses = expanded.filter(Boolean);
  return {
    clauses: clauses.length ? clauses : [base],
    compound: clauses.length > 1,
  };
}
