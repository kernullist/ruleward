#!/usr/bin/env node
import { Command } from 'commander';
import { stat } from 'node:fs/promises';
import { parseRoot } from './index';
import { loadFile, discover } from './discovery/discover';
import { parseInstructions } from './parse/parseFile';
import { analyzePath, maxSeverity } from './analyze/run';
import { toSarif } from './report/sarif';
import { formatDiagnostics } from './report/pretty';
import { SEVERITY_LEVEL, type Severity } from './diagnostics';
import type { ParsedFile } from './types';

function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

function printSummary(parsed: ParsedFile[]): void {
  let total = 0;
  let totalTokens = 0;
  for (const { file, instructions } of parsed) {
    console.log(
      `\n■ ${file.relPath}  (${file.format}, loading=${file.scope.loading}, globs=${file.scope.globs.join(',')})`
    );
    if (instructions.length === 0) {
      console.log('  (instruction 없음)');
      continue;
    }
    for (const ins of instructions) {
      total++;
      totalTokens += ins.tokens;
      const kv = ins.settingKV ? ` kv=${ins.settingKV.key}=${ins.settingKV.value}` : '';
      const refs = ins.codeReferents.length
        ? ` refs=[${ins.codeReferents.map((r) => `${r.kind}:${r.value}`).join(', ')}]`
        : '';
      const flags = [ins.directive, ins.category, ins.atomicity].join('/');
      console.log(`  L${ins.source.line} ${flags} ${ins.tokens}tok${kv}${refs}`);
      console.log(`     "${truncate(ins.raw, 80)}"`);
    }
  }
  console.log(`\nΣ ${parsed.length} 파일, ${total} instruction, ${totalTokens} tokens`);
}

const program = new Command();
program
  .name('ail')
  .description('Agent instruction file linter — Phase 0 (Instruction IR parser)')
  .version('0.0.0');

program
  .command('parse')
  .argument('<path>', '룰파일 또는 디렉토리')
  .option('--json', 'IR을 JSON으로 출력')
  .action(async (pathArg: string, opts: { json?: boolean }) => {
    const st = await stat(pathArg).catch(() => null);
    let parsed: ParsedFile[];
    if (st?.isDirectory()) {
      parsed = await parseRoot(pathArg);
    } else {
      const f = await loadFile(pathArg);
      parsed = [{ file: f, instructions: parseInstructions(f) }];
    }
    if (opts.json) console.log(JSON.stringify(parsed, null, 2));
    else printSummary(parsed);
  });

program
  .command('discover')
  .argument('<root>', '스캔할 루트 디렉토리')
  .action(async (root: string) => {
    const files = await discover(root);
    if (files.length === 0) {
      console.log('룰파일을 찾지 못했습니다.');
      return;
    }
    for (const f of files) {
      console.log(`${f.format.padEnd(11)} ${f.relPath}  [${f.scope.loading}]`);
    }
  });

program
  .command('check')
  .argument('<path>', '룰파일 또는 디렉토리')
  .option('--format <fmt>', 'pretty | sarif | json', 'pretty')
  .option('--max-level <lvl>', 'exit≠0 기준 (error|warning|info)', 'error')
  .option('--no-code-scan', '코드 인덱스(드리프트 Code→Rule) 스캔 비활성화')
  .action(async (pathArg: string, opts: { format?: string; maxLevel?: string; codeScan?: boolean }) => {
    const { diagnostics } = await analyzePath(pathArg, { scan: opts.codeScan });
    if (opts.format === 'sarif') console.log(JSON.stringify(toSarif(diagnostics), null, 2));
    else if (opts.format === 'json') console.log(JSON.stringify(diagnostics, null, 2));
    else console.log(formatDiagnostics(diagnostics));

    const lvl: Severity = opts.maxLevel === 'warning' || opts.maxLevel === 'info' ? opts.maxLevel : 'error';
    const worst = maxSeverity(diagnostics);
    if (worst && SEVERITY_LEVEL[worst] >= SEVERITY_LEVEL[lvl]) process.exitCode = 1;
  });

program.parseAsync().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
