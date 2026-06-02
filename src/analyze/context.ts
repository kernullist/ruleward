import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ParsedFile, Instruction } from '../types';
import { extractConfigFacts, type ConfigFacts } from './configFacts';
import { buildCodeIndex, type CodeIndex } from '../codeindex/scan';
import { loadSettings, DEFAULT_SETTINGS, type RulewardSettings } from '../config';

/** Check 엔진 공통 입력. */
export interface AnalysisContext {
  root: string;
  files: ParsedFile[];
  instructions: Instruction[]; // 평탄화
  config: ConfigFacts;
  codeIndex?: CodeIndex; // 드리프트(Code→Rule)용. scan=false면 미생성.
  settings: RulewardSettings; // .rulewardrc 머지 결과(임계·disable·ignore)
  exists: (relOrAbs: string) => boolean;
}

export async function buildContext(
  root: string,
  files: ParsedFile[],
  opts: { scan?: boolean; settings?: RulewardSettings } = {}
): Promise<AnalysisContext> {
  const config = await extractConfigFacts(root);
  const settings = opts.settings ?? (await loadSettings(root));
  const instructions = files.flatMap((f) => f.instructions);
  const codeIndex = opts.scan === false ? undefined : await buildCodeIndex(root);
  return {
    root,
    files,
    instructions,
    config,
    codeIndex,
    settings,
    exists: (rel: string): boolean => {
      try {
        return existsSync(path.resolve(root, rel));
      } catch {
        return false;
      }
    },
  };
}
