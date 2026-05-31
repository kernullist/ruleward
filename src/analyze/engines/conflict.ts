import type { AnalysisContext } from '../context';
import type { Instruction } from '../../types';
import { type Diagnostic, fingerprint } from '../../diagnostics';
import { scopeRelation } from '../scopeRel';

/** conflict 엔진 — Tier-0 결정론 (settingKV 충돌). DEEP-DIVE §B.2, §B.5. */

const CLOSEDISH = new Set(['closed', 'scalar', 'singleton']);

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

function importBase(v: string): string {
  const i = v.indexOf('*');
  return (i >= 0 ? v.slice(0, i) : v).replace(/['"]/g, '').replace(/\/+$/, '');
}
function sameImportTarget(a: string, b: string): boolean {
  const A = importBase(a);
  const B = importBase(b);
  return A !== '' && B !== '' && (A === B || A.startsWith(`${B}/`) || B.startsWith(`${A}/`) || A === B);
}

function collisionDiag(
  key: string,
  A: Instruction,
  B: Instruction,
  va: string,
  vb: string,
  severity: 'error' | 'warning'
): Diagnostic {
  const partial = severity === 'warning';
  return {
    checkId: 'conflict/setting-collision',
    engine: 'conflict',
    severity,
    confidence: partial ? 0.85 : 0.99,
    message: `${key} 충돌${partial ? '(스코프 부분 겹침)' : ''}: '${va}' (${A.source.file}:${A.source.line}) vs '${vb}' (${B.source.file}:${B.source.line})`,
    location: { file: A.source.file, line: A.source.line },
    related: [{ loc: { file: B.source.file, line: B.source.line }, role: `다른 값 '${vb}'` }],
    fix: { kind: 'manual', description: `'${va}' 또는 '${vb}'로 통일`, options: [va, vb] },
    fingerprint: fingerprint(['conflict/setting-collision', key, A.id, B.id]),
  };
}

/** narrower 스코프가 broader를 오버라이드 — 의도된 것일 수 있어 info. */
function overrideDiag(
  key: string,
  narrower: Instruction,
  broader: Instruction,
  narrowVal: string,
  broadVal: string
): Diagnostic {
  return {
    checkId: 'conflict/scoped-override',
    engine: 'conflict',
    severity: 'info',
    confidence: 0.9,
    message: `${key}: 더 구체적 스코프(${narrower.source.file}:${narrower.source.line}, ${narrower.scope.globs.join(',')})가 '${narrowVal}'로 상위(${broader.source.file}:${broader.source.line}, ${broader.scope.globs.join(',')})의 '${broadVal}'를 오버라이드 — 의도된 것인지 확인`,
    location: { file: narrower.source.file, line: narrower.source.line },
    related: [{ loc: { file: broader.source.file, line: broader.source.line }, role: `상위 스코프 값 '${broadVal}'` }],
    fix: { kind: 'manual', description: '의도된 오버라이드면 무시; 아니면 한쪽으로 통일' },
    fingerprint: fingerprint(['conflict/scoped-override', key, narrower.id, broader.id]),
  };
}

export function checkConflicts(ctx: AnalysisContext): Diagnostic[] {
  const out: Diagnostic[] = [];
  const withKV = ctx.instructions.filter((i) => i.settingKV !== null);

  // 1) 동일 키, 값 불일치
  for (const [key, items] of groupBy(withKV, (i) => i.settingKV!.key)) {
    const confType = items[0]!.settingKV!.confType;
    if (!CLOSEDISH.has(confType)) continue;
    const byVal = groupBy(items, (i) => i.settingKV!.value);
    if (byVal.size <= 1) continue;
    const reps = [...byVal.entries()];
    for (let a = 0; a < reps.length; a++) {
      for (let b = a + 1; b < reps.length; b++) {
        const [va, ia] = reps[a]!;
        const [vb, ib] = reps[b]!;
        const A = ia[0]!;
        const B = ib[0]!;
        const rel = scopeRelation(A.scope, B.scope);
        if (rel === 'same') out.push(collisionDiag(key, A, B, va, vb, 'error'));
        else if (rel === 'contains') out.push(overrideDiag(key, B, A, vb, va)); // A⊇B → B가 narrower
        else if (rel === 'contained') out.push(overrideDiag(key, A, B, va, vb)); // A가 narrower
        else if (rel === 'overlap') out.push(collisionDiag(key, A, B, va, vb, 'warning'));
        // disjoint → 서로 다른 파일집합 → 충돌 아님 (skip)
      }
    }
  }

  // 2) imports.restricted ∩ imports.preferred (금지 vs 권장)
  const restricted = withKV.filter((i) => i.settingKV!.key === 'imports.restricted');
  const preferred = withKV.filter((i) => i.settingKV!.key === 'imports.preferred');
  for (const r of restricted) {
    for (const p of preferred) {
      if (sameImportTarget(r.settingKV!.value, p.settingKV!.value) && scopeRelation(r.scope, p.scope) !== 'disjoint') {
        out.push({
          checkId: 'conflict/prohibit-vs-require',
          engine: 'conflict',
          severity: 'error',
          confidence: 0.97,
          message: `import 대상 '${r.settingKV!.value}'이(가) 금지와 권장으로 동시 지정됨`,
          location: { file: r.source.file, line: r.source.line },
          related: [{ loc: { file: p.source.file, line: p.source.line }, role: '권장 룰' }],
          fix: { kind: 'manual', description: '금지/권장 중 하나로 정리' },
          fingerprint: fingerprint(['conflict/prohibit-vs-require', r.id, p.id]),
        });
      }
    }
  }

  return out;
}
