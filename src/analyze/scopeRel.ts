import type { Scope } from '../types';

/** 스코프 부분순서 근사 (DEEP-DIVE §A.4, §B.5). 오버라이드 vs 버그 판정에 사용. */

export type ScopeRel = 'same' | 'contains' | 'contained' | 'overlap' | 'disjoint';

function globPrefix(g: string): string {
  const star = g.indexOf('*');
  const head = star >= 0 ? g.slice(0, star) : g;
  return head.replace(/\/+$/, '');
}

export function scopeRelation(a: Scope, b: Scope): ScopeRel {
  const bset = new Set(b.globs);
  const eq = a.globs.length === b.globs.length && a.globs.every((g) => bset.has(g));
  if (eq) return 'same';

  const aPre = a.globs.map(globPrefix);
  const bPre = b.globs.map(globPrefix);

  const aContainsB = bPre.every((bp) => aPre.some((ap) => ap === '' || bp === ap || bp.startsWith(`${ap}/`)));
  const bContainsA = aPre.every((ap) => bPre.some((bp) => bp === '' || ap === bp || ap.startsWith(`${bp}/`)));

  if (aContainsB && !bContainsA) return 'contains';
  if (bContainsA && !aContainsB) return 'contained';

  const overlap = aPre.some((ap) => bPre.some((bp) => bp === ap || bp.startsWith(`${ap}/`) || ap.startsWith(`${bp}/`)));
  return overlap ? 'overlap' : 'disjoint';
}
