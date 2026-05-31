/** 공개 API (Phase 0: Instruction IR 파서). */

export * from './types';
export { discover, loadFile } from './discovery/discover';
export { parseInstructions } from './parse/parseFile';
export { extractBlocks, type Block } from './parse/markdown';
export { atomize, normalize } from './parse/atomize';
export { detectDirective, isImperative } from './extract/modality';
export { matchSettingKV } from './extract/settingkv';
export { extractReferents } from './extract/referents';
export { classifyCategory } from './extract/category';
export { fileScope } from './extract/scope';
export { countTokens } from './tokens';

// --- 분석(Check 엔진) + 리포트 ---
export * from './diagnostics';
export { analyzePath, runChecks, maxSeverity, escalate, type AnalyzeResult } from './analyze/run';
export { buildContext, type AnalysisContext } from './analyze/context';
export { extractConfigFacts, type ConfigFacts } from './analyze/configFacts';
export { scopeRelation, type ScopeRel } from './analyze/scopeRel';
export { toSarif } from './report/sarif';
export { formatDiagnostics } from './report/pretty';
export { buildCodeIndex, scanText, type CodeIndex, type CodeSymbol } from './codeindex/scan';
export { getRuntime, scanWithRuntime } from './codeindex/treesitter';
export { checkCodeDrift } from './analyze/engines/codedrift';
export { checkSemanticConflict } from './analyze/engines/semanticConflict';
export { getNliScorer, declarativize, type NliScorer } from './semantic/nli';

import { discover } from './discovery/discover';
import { parseInstructions } from './parse/parseFile';
import type { ParsedFile } from './types';

/** 디렉토리 전체 탐색 + 파싱 → ParsedFile[]. */
export async function parseRoot(root: string): Promise<ParsedFile[]> {
  const files = await discover(root);
  return files.map((file) => ({ file, instructions: parseInstructions(file) }));
}
