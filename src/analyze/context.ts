import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ParsedFile, Instruction } from '../types';
import { extractConfigFacts, type ConfigFacts } from './configFacts';
import { buildCodeIndex, type CodeIndex } from '../codeindex/scan';

/** Check 엔진 공통 입력. */
export interface AnalysisContext {
  root: string;
  files: ParsedFile[];
  instructions: Instruction[]; // 평탄화
  config: ConfigFacts;
  codeIndex?: CodeIndex; // 드리프트(Code→Rule)용. scan=false면 미생성.
  exists: (relOrAbs: string) => boolean;
}

export async function buildContext(
  root: string,
  files: ParsedFile[],
  opts: { scan?: boolean } = {}
): Promise<AnalysisContext> {
  const config = await extractConfigFacts(root);
  const instructions = files.flatMap((f) => f.instructions);
  const codeIndex = opts.scan === false ? undefined : await buildCodeIndex(root);
  return {
    root,
    files,
    instructions,
    config,
    codeIndex,
    exists: (rel: string): boolean => {
      try {
        return existsSync(path.resolve(root, rel));
      } catch {
        return false;
      }
    },
  };
}
