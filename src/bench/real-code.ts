/**
 * clone 기반 드리프트 평가 — 실제 레포를 얕게 clone해 코드+룰을 함께 분석한다.
 * 룰파일-only 평가(bench:real)와 달리, 코드가 있어야 동작하는 drift 체크
 * (dangling-path, stale-deps, missing-guard 등)를 실세계에서 측정한다.
 * manifest에서 "루트에 룰파일이 있는" 레포 중 작은 것 N개를 골라 --depth 1 clone.
 *
 *   npm run corpus:fetch && npm run bench:real:code
 */
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzePath } from '../analyze/run';

const N = 6;
const MAX_KB = 50_000; // 50MB 초과 레포는 제외(clone 비용)

interface Meta { repo: string; path: string; format: string }

function sh(cmd: string, args: string[], timeoutMs: number): boolean {
  try {
    execFileSync(cmd, args, { stdio: 'ignore', shell: true, timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}
/* eslint-disable @typescript-eslint/no-explicit-any */
function ghJson(args: string[]): any | null {
  try {
    return JSON.parse(execFileSync('gh', args, { encoding: 'utf-8', shell: true, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const manifest = (await readFile('corpus/manifest.jsonl', 'utf-8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Meta);

  // 루트 룰파일 보유 레포(중첩 경로 제외), repo 유니크
  const byRepo = new Map<string, Meta>();
  for (const m of manifest) if (!m.path.includes('/') && !byRepo.has(m.repo)) byRepo.set(m.repo, m);

  // 크기 조회 후 작은 것부터
  const sized: Array<{ meta: Meta; size: number }> = [];
  for (const m of byRepo.values()) {
    const info = ghJson(['api', `repos/${m.repo}`]);
    const size = typeof info?.size === 'number' ? info.size : Number.POSITIVE_INFINITY;
    if (info && info.archived !== true && size > 0 && size < MAX_KB) sized.push({ meta: m, size });
    if (sized.length >= N * 4) break;
  }
  sized.sort((a, b) => a.size - b.size);
  const picks = sized.slice(0, N);
  console.log(`cloning ${picks.length} repos (smallest with a root-level rule file)...`);

  const perCheck: Record<string, number> = {};
  const review: Array<Record<string, unknown>> = [];
  let cloned = 0;

  for (const { meta, size } of picks) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rw-clone-'));
    try {
      if (!sh('git', ['clone', '--depth', '1', '--single-branch', `https://github.com/${meta.repo}.git`, dir], 180_000)) {
        console.log(`  skip (clone failed) ${meta.repo}`);
        continue;
      }
      const { diagnostics } = await analyzePath(dir);
      cloned++;
      const drift = diagnostics.filter((d) => d.engine === 'drift');
      console.log(`  ${meta.repo} (${size}KB): ${diagnostics.length} findings, ${drift.length} drift`);
      for (const d of diagnostics) {
        perCheck[d.checkId] = (perCheck[d.checkId] ?? 0) + 1;
        if (d.engine === 'drift' && review.length < 30) {
          review.push({ repo: meta.repo, checkId: d.checkId, severity: d.severity, message: d.message });
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  console.log(`\n═══ clone-drift eval (${cloned} repos analyzed) ═══`);
  for (const [id, c] of Object.entries(perCheck).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(c).padStart(3)}  ${id}`);
  }
  await writeFile('corpus/review-code.jsonl', `${review.map((r) => JSON.stringify(r)).join('\n')}\n`);
  console.log(`\ndrift review sample (${review.length}) → corpus/review-code.jsonl`);
}

await main();
