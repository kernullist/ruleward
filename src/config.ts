import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/** `.rulewardrc(.json)` 설정 — 임계 조정·체크 비활성·파일 무시 (실프로젝트 FP 억제 수단). */

export interface RulewardSettings {
  disable: string[]; // 끌 checkId/engine (예: "bloat/vague", "drift")
  errorOn: string[]; // error로 승격할 checkId/engine
  ignore: string[]; // 린트에서 제외할 룰파일 glob
  tokenBudgetFile: number;
  tokenBudgetAlways: number;
  nearDupJaccard: number;
  nliThreshold: number;
}

export const DEFAULT_SETTINGS: RulewardSettings = {
  disable: [],
  errorOn: [],
  ignore: [],
  tokenBudgetFile: 4000,
  tokenBudgetAlways: 4000,
  nearDupJaccard: 0.85,
  nliThreshold: 0.9,
};

const Schema = z
  .object({
    disable: z.array(z.string()).optional(),
    errorOn: z.array(z.string()).optional(),
    ignore: z.array(z.string()).optional(),
    tokenBudget: z.number().positive().optional(), // 단축: file+always 동시 설정
    tokenBudgetFile: z.number().positive().optional(),
    tokenBudgetAlways: z.number().positive().optional(),
    nearDupJaccard: z.number().min(0).max(1).optional(),
    nliThreshold: z.number().min(0).max(1).optional(),
  })
  .strict();

export async function loadSettings(root: string): Promise<RulewardSettings> {
  for (const name of ['.rulewardrc.json', '.rulewardrc']) {
    let raw: string;
    try {
      raw = await readFile(path.join(root, name), 'utf-8');
    } catch {
      continue; // 파일 없음 → 다음 후보
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(`${name} is not valid JSON`);
    }
    const r = Schema.safeParse(json);
    if (!r.success) throw new Error(`${name} invalid: ${r.error.issues.map((i) => i.message).join('; ')}`);
    const c = r.data;
    return {
      disable: c.disable ?? [],
      errorOn: c.errorOn ?? [],
      ignore: c.ignore ?? [],
      tokenBudgetFile: c.tokenBudgetFile ?? c.tokenBudget ?? DEFAULT_SETTINGS.tokenBudgetFile,
      tokenBudgetAlways: c.tokenBudgetAlways ?? c.tokenBudget ?? DEFAULT_SETTINGS.tokenBudgetAlways,
      nearDupJaccard: c.nearDupJaccard ?? DEFAULT_SETTINGS.nearDupJaccard,
      nliThreshold: c.nliThreshold ?? DEFAULT_SETTINGS.nliThreshold,
    };
  }
  return { ...DEFAULT_SETTINGS };
}

/** disable/errorOn 패턴 매칭: engine명 · 정확한 checkId · checkId prefix. */
export function matchesCheck(d: { checkId: string; engine: string }, patterns: string[]): boolean {
  return patterns.some((p) => d.engine === p || d.checkId === p || d.checkId.startsWith(`${p}/`));
}
