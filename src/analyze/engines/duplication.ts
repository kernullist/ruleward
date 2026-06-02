import type { AnalysisContext } from '../context';
import type { Instruction } from '../../types';
import { type Diagnostic, fingerprint } from '../../diagnostics';

/** duplication 엔진 — 룰↔설정 중복(visibility check). DEEP-DIVE §6.2. */

function redundantDiag(ins: Instruction, why: string, source: string): Diagnostic {
  return {
    checkId: 'duplication/redundant-with-config',
    engine: 'duplication',
    severity: 'warning',
    confidence: 0.85,
    message: `설정 파일과 중복: ${why}`,
    location: { file: ins.source.file, line: ins.source.line },
    fix: { kind: 'auto', description: `이 룰 삭제 (${source}가 이미 강제)`, edits: [{ file: ins.source.file, line: ins.source.line, newText: '', mode: 'delete' }] },
    fingerprint: fingerprint(['duplication/redundant-with-config', ins.id, source]),
  };
}

function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[`'".,;:()[\]]/g, ' ').split(/\s+/).filter((w) => w.length >= 2));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}
function dupDiag(a: Instruction, b: Instruction, kind: 'exact' | 'near', score?: number): Diagnostic {
  const exact = kind === 'exact';
  return {
    checkId: 'duplication/rule-rule',
    engine: 'duplication',
    severity: exact ? 'warning' : 'info',
    confidence: exact ? 0.95 : 0.7,
    message: exact
      ? `중복 룰(동일): "${a.normalized}"`
      : `유사 중복(Jaccard ${score?.toFixed(2)}): "${a.normalized}" ↔ "${b.normalized}"`,
    location: { file: a.source.file, line: a.source.line },
    related: [{ loc: { file: b.source.file, line: b.source.line }, role: '중복 상대' }],
    fix: exact
      ? { kind: 'auto', description: '한쪽 삭제', edits: [{ file: b.source.file, line: b.source.line, newText: '', mode: 'delete' }] }
      : { kind: 'manual', description: '하나로 통합 검토' },
    fingerprint: fingerprint(['duplication/rule-rule', ...[a.id, b.id].sort()]),
  };
}

export function checkDuplication(ctx: AnalysisContext): Diagnostic[] {
  const out: Diagnostic[] = [];
  const c = ctx.config;

  for (const ins of ctx.instructions) {
    const kv = ins.settingKV;

    // packageManager 재진술
    if (kv?.key === 'packageManager' && c.packageManager && kv.value === c.packageManager) {
      out.push(redundantDiag(ins, `package.json이 이미 packageManager=${c.packageManager} 선언`, 'package.json'));
      continue;
    }

    // 포매터 설정 재진술 (prettier/.editorconfig)
    if (kv && kv.key.startsWith('style.') && c.style[kv.key] !== undefined && c.style[kv.key] === kv.value) {
      out.push(redundantDiag(ins, `포매터 설정(${kv.key}=${kv.value})과 중복`, 'prettier/.editorconfig'));
      continue;
    }

    // "Use TypeScript" — tsconfig 존재 시 자명
    if (
      !kv &&
      c.hasTsconfig &&
      ins.polarity !== 'prohibition' &&
      ins.tokens < 10 &&
      /\btypescript\b/.test(ins.normalized.toLowerCase())
    ) {
      out.push(redundantDiag(ins, 'tsconfig.json 존재 → TypeScript 사용은 자명', 'tsconfig.json'));
    }
  }

  // 룰-룰 중복(완전/근접) — n이 수백 규모라 직접 Jaccard로 충분(MinHash는 스케일 시 도입).
  // 최소 4토큰 가드: "Must have" 같은 헤딩/라벨 조각이 중복으로 오탐되는 것 방지(실세계 FP).
  const cand = ctx.instructions
    .filter((i) => i.atomicity !== 'narrative' && i.normalized.length > 0)
    .map((i) => ({ ins: i, t: tokenize(i.normalized) }))
    .filter((e) => e.t.size >= 4);
  const ruleLike = cand.map((e) => e.ins);
  const tokenSets = cand.map((e) => e.t);
  for (let a = 0; a < ruleLike.length; a++) {
    for (let b = a + 1; b < ruleLike.length; b++) {
      const A = ruleLike[a]!;
      const B = ruleLike[b]!;
      if (A.normalized.toLowerCase() === B.normalized.toLowerCase()) {
        out.push(dupDiag(A, B, 'exact'));
        continue;
      }
      const ta = tokenSets[a]!;
      const tb = tokenSets[b]!;
      if (ta.size < 3 || tb.size < 3) continue;
      const j = jaccard(ta, tb);
      if (j >= 0.85) out.push(dupDiag(A, B, 'near', j));
    }
  }

  return out;
}
