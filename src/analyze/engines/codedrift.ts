import type { AnalysisContext } from '../context';
import type { Instruction } from '../../types';
import type { CodeSymbol } from '../../codeindex/scan';
import { type Diagnostic, fingerprint } from '../../diagnostics';

/** drift 엔진 (Code→Rule) — 헤드라인 기능: 폐기 심볼을 막는 가드 룰 누락 탐지. DEEP-DIVE §C.5. */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 해당 심볼명을 언급하는 instruction들. */
function mentioningInstructions(name: string, instructions: Instruction[]): Instruction[] {
  const re = new RegExp(`(^|[^\\w$])${escapeRe(name)}([^\\w$]|$)`);
  return instructions.filter(
    (i) =>
      i.codeReferents.some((r) => r.value === name || r.value.split('/').pop() === name) ||
      re.test(i.raw)
  );
}

function draftRule(sym: CodeSymbol): string {
  return sym.replacement
    ? `- \`${sym.name}\` 사용 금지(deprecated); \`${sym.replacement}\` 사용.`
    : `- \`${sym.name}\` 사용 금지(deprecated).`;
}

function missingGuardDiag(sym: CodeSymbol): Diagnostic {
  return {
    checkId: 'drift/missing-guard-rule',
    engine: 'drift',
    severity: 'info',
    confidence: 0.5,
    message:
      `코드에서 \`${sym.name}\`가 deprecated(${sym.file}:${sym.line})` +
      `${sym.replacement ? ` — 대체: \`${sym.replacement}\`` : ''}이지만, 이를 막는 룰이 없음. 가드 룰 추가 권장.`,
    location: { file: sym.file, line: sym.line },
    fix: { kind: 'assisted', description: `룰파일에 추가: ${draftRule(sym)}` },
    fingerprint: fingerprint(['drift/missing-guard-rule', sym.name, sym.file]),
  };
}

function recommendedDeprecatedDiag(ins: Instruction, sym: CodeSymbol): Diagnostic {
  return {
    checkId: 'drift/deprecated-symbol-recommended',
    engine: 'drift',
    severity: 'warning',
    confidence: 0.7,
    message:
      `룰이 deprecated 심볼 \`${sym.name}\` 사용을 권장/허용함` +
      `${sym.replacement ? ` — 대체: \`${sym.replacement}\`` : ''} (선언: ${sym.file}:${sym.line})`,
    location: { file: ins.source.file, line: ins.source.line },
    related: [{ loc: { file: sym.file, line: sym.line }, role: '@deprecated 선언' }],
    fix: { kind: 'manual', description: `룰을 '${sym.replacement ?? '대체 심볼'}' 기준으로 수정` },
    fingerprint: fingerprint(['drift/deprecated-symbol-recommended', ins.id, sym.name]),
  };
}

export function checkCodeDrift(ctx: AnalysisContext): Diagnostic[] {
  const idx = ctx.codeIndex;
  if (!idx) return [];
  const out: Diagnostic[] = [];

  // 같은 심볼이 여러 곳에서 deprecated일 수 있음 → 이름 기준 1회만
  const seen = new Set<string>();
  for (const sym of idx.deprecated) {
    if (seen.has(sym.name)) continue;
    seen.add(sym.name);

    const mentions = mentioningInstructions(sym.name, ctx.instructions);
    if (mentions.length === 0) {
      out.push(missingGuardDiag(sym)); // 헤드라인: 가드 룰 누락
      continue;
    }
    const guarded = mentions.some((i) => i.polarity === 'prohibition');
    if (!guarded) {
      const rec = mentions.find((i) => i.polarity === 'requirement' || i.polarity === 'preference') ?? mentions[0]!;
      out.push(recommendedDeprecatedDiag(rec, sym));
    }
    // guarded → 정상(룰이 이미 금지) → 진단 없음
  }
  return out;
}
