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

  return out;
}
