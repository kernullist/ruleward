import type { Instruction, RuleFile, Atomicity } from '../types';
import { extractBlocks, type Block } from './markdown';
import { atomize, normalize } from './atomize';
import { detectDirective, isImperative } from '../extract/modality';
import { matchSettingKV } from '../extract/settingkv';
import { extractReferents } from '../extract/referents';
import { classifyCategory } from '../extract/category';
import { countTokens } from '../tokens';

/** 룰파일 → Instruction[] (Instruction IR). */
export function parseInstructions(file: RuleFile): Instruction[] {
  const blocks = extractBlocks(file.body);
  const out: Instruction[] = [];
  let idx = 0;

  for (const b of blocks) {
    const blockNorm = normalize(b.text);
    const blockDir = detectDirective(blockNorm);

    // narrative(서술 산문): 분할하지 않고 한 덩어리로 (룰 분석 제외, 토큰엔 계상)
    if (blockDir.directive === 'INFO' && !isImperative(blockNorm)) {
      out.push(makeInstruction(file, b, b.text, blockNorm, idx++, false, 'narrative'));
      continue;
    }

    const { clauses, compound } = atomize(b.text);
    for (const clause of clauses) {
      out.push(makeInstruction(file, b, clause, normalize(clause), idx++, compound, 'atomic'));
    }
  }
  return out;
}

function makeInstruction(
  file: RuleFile,
  b: Block,
  raw: string,
  norm: string,
  idx: number,
  fromCompound: boolean,
  atomicity: Atomicity
): Instruction {
  const { directive, polarity } = detectDirective(norm);
  const settingKV = matchSettingKV(norm);
  const category = classifyCategory(norm, settingKV);
  const codeReferents = extractReferents(raw);
  const headingKey = b.headingPath.join('/') || '_';
  return {
    id: `${file.relPath}#${headingKey}#L${b.line}.${idx}`,
    source: { file: file.relPath, line: b.line, headingPath: b.headingPath },
    raw,
    normalized: norm,
    directive,
    polarity,
    atomicity,
    fromCompound,
    scope: file.scope,
    category,
    settingKV,
    codeReferents,
    tokens: countTokens(raw),
  };
}
