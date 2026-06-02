/**
 * 실세계 룰파일 수집기 (부트스트랩). GitHub 코드 검색(gh) → raw 본문 → content-hash 중복제거 → manifest.
 * 본문(corpus/files)은 재배포 안 함(gitignore). manifest(메타데이터)만 커밋해 재현성 확보.
 *
 *   npm run corpus:fetch
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const OUT = 'corpus';
const FILES = path.join(OUT, 'files');
mkdirSync(FILES, { recursive: true });

const TARGETS = [
  { filename: 'AGENTS.md', format: 'agents' },
  { filename: 'CLAUDE.md', format: 'claude' },
];
const PAGES = 2; // ×100 candidates per filename
const PER_FORMAT_CAP = 80; // unique files kept per format
const MAX_BYTES = 200_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/* eslint-disable @typescript-eslint/no-explicit-any */
function ghJson(args: string[]): any | null {
  try {
    const out = execFileSync('gh', args, { encoding: 'utf-8', maxBuffer: 128 * 1024 * 1024, shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

interface Candidate { repo: string; path: string; format: string }

async function search(): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const t of TARGETS) {
    for (let p = 1; p <= PAGES; p++) {
      const data = ghJson(['api', '-X', 'GET', 'search/code', '-f', `q=filename:${t.filename}`, '-F', 'per_page=100', '-F', `page=${p}`]);
      const items: any[] = data?.items ?? [];
      for (const it of items) out.push({ repo: it.repository.full_name, path: it.path, format: t.format });
      console.log(`  search ${t.filename} page ${p}: +${items.length}`);
      if (items.length < 100) break;
      await sleep(7000); // code search rate limit (~10/min)
    }
  }
  return out;
}

async function main(): Promise<void> {
  console.log('searching GitHub code...');
  const candidates = await search();

  const seenHash = new Set<string>();
  const seenRepoPath = new Set<string>();
  const perFormat: Record<string, number> = {};
  const manifest: Array<Record<string, unknown>> = [];

  for (const c of candidates) {
    if ((perFormat[c.format] ?? 0) >= PER_FORMAT_CAP) continue;
    const key = `${c.repo}:${c.path}`;
    if (seenRepoPath.has(key)) continue;
    seenRepoPath.add(key);

    const meta = ghJson(['api', `repos/${c.repo}/contents/${c.path}`]);
    if (!meta || meta.encoding !== 'base64' || typeof meta.content !== 'string') continue;
    const content = Buffer.from(meta.content, 'base64').toString('utf-8');
    if (!content.trim() || content.length > MAX_BYTES) continue;

    const hash = createHash('sha1').update(content).digest('hex').slice(0, 16);
    if (seenHash.has(hash)) continue; // exact-content dedup (kills template copies)
    seenHash.add(hash);
    perFormat[c.format] = (perFormat[c.format] ?? 0) + 1;

    writeFileSync(path.join(FILES, `${hash}.md`), content);
    manifest.push({
      hash,
      repo: c.repo,
      path: c.path,
      format: c.format,
      bytes: content.length,
      url: `https://github.com/${c.repo}/blob/HEAD/${c.path}`,
    });
  }

  writeFileSync(path.join(OUT, 'manifest.jsonl'), `${manifest.map((m) => JSON.stringify(m)).join('\n')}\n`);
  console.log(`\ncollected ${manifest.length} unique files ${JSON.stringify(perFormat)} → ${OUT}/`);
}

await main();
