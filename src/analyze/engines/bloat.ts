import type { AnalysisContext } from '../context';
import type { Instruction } from '../../types';
import { type Diagnostic, fingerprint } from '../../diagnostics';

/** bloat 엔진 — 토큰 예산 + 모호 룰. DEEP-DIVE §6.3. */

const ALWAYS_BUDGET = 2000; // always-on 합계 권장 상한(tok)
const FILE_BUDGET = 1500; // 단일 always-on 파일 상한(tok)

const VAGUE: RegExp[] = [
  /\bclean code\b/,
  /\bbest practices?\b/,
  /\bmaintainable\b/,
  /\breadable\b/,
  /\bproperly\b/,
  /\bgood (code|practices?)\b/,
  /\bhigh.quality\b/,
  /\bas needed\b/,
  /\bbe careful\b/,
  /\bwhere appropriate\b/,
  /클린\s?코드/,
  /가독성/,
  /유지보수/,
  /적절(히|하게|한)/,
  /베스트\s?프랙티스/,
  /깔끔(하게|히)/,
];

function budgetDiag(label: string, tokens: number, budget: number, scope: 'file' | 'aggregate'): Diagnostic {
  return {
    checkId: 'bloat/token-budget',
    engine: 'bloat',
    severity: 'warning',
    confidence: 1.0,
    message: `${scope === 'aggregate' ? 'always-on 합계' : label}가 ${tokens} 토큰 — 권장 ${budget} 초과. 분할 또는 스코프 한정 권장.`,
    location: { file: scope === 'aggregate' ? label : label, line: 1 },
    fix: { kind: 'manual', description: '룰을 glob 스코프로 분리하거나 on-demand(참조 파일)로 이동' },
    fingerprint: fingerprint(['bloat/token-budget', label]),
  };
}

function vagueDiag(ins: Instruction): Diagnostic {
  return {
    checkId: 'bloat/vague',
    engine: 'bloat',
    severity: 'info',
    confidence: 0.6,
    message: `모호한 룰(해석 자유도 큼): "${ins.normalized}". 구체적 제약으로 바꾸거나 제거 검토.`,
    location: { file: ins.source.file, line: ins.source.line },
    fix: { kind: 'assisted', description: '구체적·검증가능한 제약으로 재작성' },
    fingerprint: fingerprint(['bloat/vague', ins.id]),
  };
}

export function checkBloat(ctx: AnalysisContext): Diagnostic[] {
  const out: Diagnostic[] = [];

  // 토큰 예산
  let alwaysTotal = 0;
  let alwaysFiles = 0;
  for (const f of ctx.files) {
    if (f.file.scope.loading !== 'always') continue;
    alwaysFiles++;
    const t = f.instructions.reduce((s, i) => s + i.tokens, 0);
    alwaysTotal += t;
    if (t > FILE_BUDGET) out.push(budgetDiag(f.file.relPath, t, FILE_BUDGET, 'file'));
  }
  // 합계 진단은 always-on 파일이 둘 이상일 때만 — 단일 파일이면 per-file 진단이 곧 합계라 중복.
  if (alwaysFiles > 1 && alwaysTotal > ALWAYS_BUDGET) {
    out.push(budgetDiag('(always-on 합계)', alwaysTotal, ALWAYS_BUDGET, 'aggregate'));
  }

  // 모호 룰
  for (const ins of ctx.instructions) {
    if (ins.atomicity === 'narrative') continue;
    if (ins.settingKV !== null) continue;
    if (ins.codeReferents.length > 0) continue;
    if (VAGUE.some((re) => re.test(ins.normalized.toLowerCase()))) out.push(vagueDiag(ins));
  }

  return out;
}
