import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ParsedFile, Instruction } from '../types';
import { extractConfigFacts, type ConfigFacts } from './configFacts';

/** Check 엔진 공통 입력. */
export interface AnalysisContext {
  root: string;
  files: ParsedFile[];
  instructions: Instruction[]; // 평탄화
  config: ConfigFacts;
  exists: (relOrAbs: string) => boolean;
}

export async function buildContext(root: string, files: ParsedFile[]): Promise<AnalysisContext> {
  const config = await extractConfigFacts(root);
  const instructions = files.flatMap((f) => f.instructions);
  return {
    root,
    files,
    instructions,
    config,
    exists: (rel: string): boolean => {
      try {
        return existsSync(path.resolve(root, rel));
      } catch {
        return false;
      }
    },
  };
}
