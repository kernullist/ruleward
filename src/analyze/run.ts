import path from 'node:path';
import { stat } from 'node:fs/promises';
import type { ParsedFile } from '../types';
import { type Diagnostic, type Severity, SEVERITY_LEVEL } from '../diagnostics';
import { discover, loadFile } from '../discovery/discover';
import { parseInstructions } from '../parse/parseFile';
import { buildContext, type AnalysisContext } from './context';
import { checkConflicts } from './engines/conflict';
import { checkDuplication } from './engines/duplication';
import { checkBloat } from './engines/bloat';
import { checkDrift } from './engines/drift';

/** 4개 Engine 실행 → 심각도·신뢰도 내림차순 정렬. */
export function runChecks(ctx: AnalysisContext): Diagnostic[] {
  return [checkConflicts, checkDuplication, checkBloat, checkDrift]
    .flatMap((fn) => fn(ctx))
    .sort((a, b) => SEVERITY_LEVEL[b.severity] - SEVERITY_LEVEL[a.severity] || b.confidence - a.confidence);
}

export interface AnalyzeResult {
  root: string;
  files: ParsedFile[];
  diagnostics: Diagnostic[];
}

/** 파일 또는 디렉토리 경로 → 분석 결과. 파일이면 그 디렉토리를 root(설정 컨텍스트)로. */
export async function analyzePath(target: string): Promise<AnalyzeResult> {
  const st = await stat(target).catch(() => null);
  let root: string;
  let files: ParsedFile[];
  if (st?.isDirectory()) {
    root = target;
    const ruleFiles = await discover(target);
    files = ruleFiles.map((file) => ({ file, instructions: parseInstructions(file) }));
  } else {
    root = path.dirname(target);
    const file = await loadFile(target, root);
    files = [{ file, instructions: parseInstructions(file) }];
  }
  const ctx = await buildContext(root, files);
  return { root, files, diagnostics: runChecks(ctx) };
}

export function maxSeverity(diags: Diagnostic[]): Severity | null {
  let max: Severity | null = null;
  for (const d of diags) {
    if (max === null || SEVERITY_LEVEL[d.severity] > SEVERITY_LEVEL[max]) max = d.severity;
  }
  return max;
}
