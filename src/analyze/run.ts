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
import { checkCodeDrift } from './engines/codedrift';
import { checkSemanticConflict } from './engines/semanticConflict';
import { getNliScorer } from '../semantic/nli';
import { loadSettings, matchesCheck, type RulewardSettings } from '../config';

/** Engine 실행 → 심각도·신뢰도 내림차순 정렬. */
export function runChecks(ctx: AnalysisContext): Diagnostic[] {
  return [checkConflicts, checkDuplication, checkBloat, checkDrift, checkCodeDrift]
    .flatMap((fn) => fn(ctx))
    .sort((a, b) => SEVERITY_LEVEL[b.severity] - SEVERITY_LEVEL[a.severity] || b.confidence - a.confidence);
}

export interface AnalyzeResult {
  root: string;
  files: ParsedFile[];
  diagnostics: Diagnostic[];
  settings: RulewardSettings;
}

/** 파일 또는 디렉토리 경로 → 분석 결과. 파일이면 그 디렉토리를 root(설정 컨텍스트)로. */
export async function analyzePath(
  target: string,
  opts: { scan?: boolean; semantic?: boolean } = {}
): Promise<AnalyzeResult> {
  const st = await stat(target).catch(() => null);
  const root = st?.isDirectory() ? target : path.dirname(target);
  const settings = await loadSettings(root);

  let files: ParsedFile[];
  if (st?.isDirectory()) {
    const ruleFiles = await discover(root, settings.ignore);
    files = ruleFiles.map((file) => ({ file, instructions: parseInstructions(file) }));
  } else {
    const file = await loadFile(target, root);
    files = [{ file, instructions: parseInstructions(file) }];
  }

  const ctx = await buildContext(root, files, { scan: opts.scan, settings });
  let diagnostics = runChecks(ctx);

  // opt-in 의미 분석 계층(NLI). 모델 미가용 시 조용히 생략(결정론 결과만).
  if (opts.semantic) {
    const scorer = await getNliScorer();
    if (scorer) diagnostics.push(...(await checkSemanticConflict(ctx, scorer, settings.nliThreshold)));
  }

  // .rulewardrc의 disable 적용(FP 억제 수단) 후 심각도·신뢰도 정렬.
  diagnostics = diagnostics
    .filter((d) => !matchesCheck(d, settings.disable))
    .sort((a, b) => SEVERITY_LEVEL[b.severity] - SEVERITY_LEVEL[a.severity] || b.confidence - a.confidence);

  return { root, files, diagnostics, settings };
}

export function maxSeverity(diags: Diagnostic[]): Severity | null {
  let max: Severity | null = null;
  for (const d of diags) {
    if (max === null || SEVERITY_LEVEL[d.severity] > SEVERITY_LEVEL[max]) max = d.severity;
  }
  return max;
}

/** 지정한 check/engine 진단을 error로 승격(CI 게이팅용). 패턴 = engine명 또는 checkId 또는 그 prefix. */
export function escalate(diags: Diagnostic[], patterns: string[]): Diagnostic[] {
  if (patterns.length === 0) return diags;
  return diags.map((d) =>
    patterns.some((p) => d.engine === p || d.checkId === p || d.checkId.startsWith(`${p}/`))
      ? { ...d, severity: 'error' as const }
      : d
  );
}
