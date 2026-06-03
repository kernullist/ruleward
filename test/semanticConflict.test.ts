import { describe, it, expect } from 'vitest';
import { checkSemanticConflict } from '../src/analyze/engines/semanticConflict';
import { parsedFile, makeCtx } from './helpers';
import type { NliScorer } from '../src/semantic/nli';

// 모델 없이 게이팅/후보생성 로직만 검증 (스코러 주입).
describe('checkSemanticConflict (candidate gen + gating, mock scorer)', () => {
  it('flags a same-topic semantic contradiction', async () => {
    const ctx = makeCtx([parsedFile('- Keep functions small.\n- Prefer large comprehensive functions.\n')]);
    const mock: NliScorer = async (a, b) => (/function/i.test(a) && /function/i.test(b) ? 0.95 : 0.1);
    const d = await checkSemanticConflict(ctx, mock);
    expect(d.some((x) => x.checkId === 'conflict/nli-contradiction' && x.severity === 'info')).toBe(true);
  });

  it('does not even score unrelated-topic pairs (topic gate prevents off-distribution FP)', async () => {
    const ctx = makeCtx([parsedFile('- Validate external input.\n- Log issues with structured detail.\n')]);
    let calls = 0;
    const spy: NliScorer = async () => {
      calls++;
      return 0.99;
    };
    const d = await checkSemanticConflict(ctx, spy);
    expect(d.length).toBe(0);
    expect(calls).toBe(0); // 토픽 안 겹침 → 스코러 호출 자체가 없어야
  });

  it('skips pairs already owned by deterministic settingKV (same key)', async () => {
    const ctx = makeCtx([parsedFile('- Use tabs for indentation.\n- Use spaces for indentation.\n')]);
    const spy: NliScorer = async () => 0.99;
    const d = await checkSemanticConflict(ctx, spy);
    expect(d.length).toBe(0); // 둘 다 style.indent → Tier-0가 담당
  });

  it('skips markdown-table rows and long prose (not rule-like; real-corpus FP guard)', async () => {
    const body = `- | Step | Always validate inputs |\n- Always ${'validate handle process audit '.repeat(12)}inputs\n`;
    const ctx = makeCtx([parsedFile(body)]);
    let calls = 0;
    const spy: NliScorer = async () => {
      calls += 1;
      return 0.99;
    };
    expect((await checkSemanticConflict(ctx, spy)).length).toBe(0);
    expect(calls).toBe(0);
  });
});
