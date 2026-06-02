/**
 * 실세계 코퍼스 평가 — corpus/files의 실제 룰파일에 룰파일-only 엔진을 돌려
 * 현실 finding 분포를 집계하고, 수작업 TP/FP 라벨용 표본을 추출한다.
 * (drift는 코드가 필요, NLI는 모델이 필요 → 별도. 여기선 conflict/duplication/bloat만.)
 *
 *   npm run corpus:fetch && npm run bench:real
 */
import { readdir, readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseInstructions } from '../parse/parseFile';
import { DEFAULT_SETTINGS } from '../config';
import { checkConflicts } from '../analyze/engines/conflict';
import { checkDuplication } from '../analyze/engines/duplication';
import { checkBloat } from '../analyze/engines/bloat';
import type { RuleFile, Scope, ParsedFile, FileFormat } from '../types';
import type { AnalysisContext } from '../analyze/context';
import type { ConfigFacts } from '../analyze/configFacts';
import type { Diagnostic } from '../diagnostics';

const CORPUS = 'corpus';
const FILES = path.join(CORPUS, 'files');
const REVIEW_CAP = 12;

const EMPTY_CONFIG: ConfigFacts = {
  hasPackageJson: false,
  hasTsconfig: false,
  deps: new Set(),
  scripts: new Set(),
  tsAliases: [],
  tsAliasScopes: [],
  style: {},
};
const BROAD: Scope = { globs: ['**'], loading: 'always', dirBoundary: '.' };

function ctxFor(file: RuleFile): AnalysisContext {
  const instructions = parseInstructions(file);
  const pf: ParsedFile = { file, instructions };
  return { root: CORPUS, files: [pf], instructions, config: EMPTY_CONFIG, settings: DEFAULT_SETTINGS, exists: () => false };
}

interface Meta {
  hash: string;
  repo: string;
  path: string;
  format: string;
  url: string;
  bytes: number;
}

async function main(): Promise<void> {
  const manifestRaw = await readFile(path.join(CORPUS, 'manifest.jsonl'), 'utf-8');
  const metas: Record<string, Meta> = {};
  for (const line of manifestRaw.split('\n')) {
    if (!line.trim()) continue;
    const m = JSON.parse(line) as Meta;
    metas[m.hash] = m;
  }

  const files = (await readdir(FILES)).filter((f) => f.endsWith('.md'));
  let totalInstr = 0;
  let filesWithFindings = 0;
  const perCheck: Record<string, number> = {};
  const findingsPerFile: number[] = [];
  const review: Array<Record<string, unknown>> = [];
  const reviewCount: Record<string, number> = {};

  for (const f of files) {
    const hash = f.replace(/\.md$/, '');
    const meta = metas[hash];
    const body = await readFile(path.join(FILES, f), 'utf-8');
    const rf: RuleFile = {
      relPath: meta?.path ?? f,
      absPath: path.resolve(FILES, f),
      format: (meta?.format ?? 'agents') as FileFormat,
      frontmatter: {},
      body,
      scope: BROAD,
    };
    const ctx = ctxFor(rf);
    totalInstr += ctx.instructions.length;

    const diags: Diagnostic[] = [...checkConflicts(ctx), ...checkDuplication(ctx), ...checkBloat(ctx)];
    findingsPerFile.push(diags.length);
    if (diags.length > 0) filesWithFindings++;

    for (const d of diags) {
      perCheck[d.checkId] = (perCheck[d.checkId] ?? 0) + 1;
      if ((reviewCount[d.checkId] ?? 0) < REVIEW_CAP) {
        reviewCount[d.checkId] = (reviewCount[d.checkId] ?? 0) + 1;
        review.push({ checkId: d.checkId, severity: d.severity, message: d.message, repo: meta?.repo, url: meta?.url });
      }
    }
  }

  const n = files.length;
  findingsPerFile.sort((a, b) => a - b);
  const mean = findingsPerFile.reduce((a, b) => a + b, 0) / n;
  const pct = (x: number): string => `${((x / n) * 100).toFixed(0)}%`;

  console.log(`\n═══ ruleward real-world corpus (${n} files, ${totalInstr} instructions) ═══`);
  console.log(`files with ≥1 finding: ${filesWithFindings}/${n} (${pct(filesWithFindings)})`);
  console.log(`findings/file: mean ${mean.toFixed(2)} · median ${findingsPerFile[Math.floor(n / 2)]} · max ${findingsPerFile[n - 1]}\n`);
  console.log('per-check counts (rule-file-only engines; drift & NLI excluded):');
  for (const [id, c] of Object.entries(perCheck).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(c).padStart(4)}  ${id}`);
  }

  writeFileSync(path.join(CORPUS, 'review.jsonl'), `${review.map((r) => JSON.stringify(r)).join('\n')}\n`);
  console.log(`\nreview sample (${review.length} findings) → ${CORPUS}/review.jsonl  — hand-label TP/FP to estimate precision`);
}

await main();
