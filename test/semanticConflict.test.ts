import { describe, it, expect } from 'vitest';
import { checkSemanticConflict } from '../src/analyze/engines/semanticConflict';
import { parsedFile, makeCtx } from './helpers';
import type { NliScorer } from '../src/semantic/nli';

// 모델 없이 후보선정(공유대상/반대극성 게이트)만 검증 (스코러 주입).
describe('checkSemanticConflict (subject + polarity gating, mock scorer)', () => {
  it('flags a contradiction on a shared referent with opposing polarity', async () => {
    const ctx = makeCtx([parsedFile('- Always use `fetch` for HTTP.\n- Never use `fetch`; prefer `axios`.\n')]);
    const mock: NliScorer = async (a, b) => (/fetch/i.test(a) && /fetch/i.test(b) ? 0.95 : 0.1);
    const d = await checkSemanticConflict(ctx, mock);
    const hit = d.find((x) => x.checkId === 'conflict/nli-contradiction');
    expect(hit?.severity).toBe('info');
    expect(hit?.message).toContain('fetch');
    expect(hit?.message).toContain('반대극성'); // requirement ⟂ prohibition
  });

  it('flags value-opposition on a shared referent even with same polarity', async () => {
    const ctx = makeCtx([parsedFile('- Keep `parseConfig` small and focused.\n- Make `parseConfig` large and comprehensive.\n')]);
    const mock: NliScorer = async (a, b) => (/parseconfig/i.test(a) && /parseconfig/i.test(b) ? 0.95 : 0.1);
    const d = await checkSemanticConflict(ctx, mock);
    const hit = d.find((x) => x.checkId === 'conflict/nli-contradiction');
    expect(hit?.message).toContain('parseConfig');
    expect(hit?.message).toContain('값 대립'); // same polarity, antonymic predicate
  });

  it('does NOT score pairs about different referents (complementary, not contradictory)', async () => {
    // 실코퍼스 FP(4): "Never use `tower run`" ⟂ "Always use `tower-mcp`" → 서로 다른 대상 → 상보적.
    const ctx = makeCtx([parsedFile('- Never use `tower run` directly.\n- Always use `tower-mcp` instead.\n')]);
    let calls = 0;
    const spy: NliScorer = async () => {
      calls += 1;
      return 0.99;
    };
    expect((await checkSemanticConflict(ctx, spy)).length).toBe(0);
    expect(calls).toBe(0); // 공유 대상 없음 → 스코러 호출 자체가 없어야
  });

  it('does not score permissions (MAY) — "X can be Y" cannot contradict', async () => {
    // 실코퍼스 FP 주범: 튜토리얼 산문 "A `ParamSet` can take ..." 가 directive로 오분류됨.
    const ctx = makeCtx([parsedFile('- The `cache` may be enabled.\n- The `cache` can be disabled.\n')]);
    let calls = 0;
    const spy: NliScorer = async () => {
      calls += 1;
      return 0.99;
    };
    expect((await checkSemanticConflict(ctx, spy)).length).toBe(0);
    expect(calls).toBe(0);
  });

  it('does not even score referent-less prose (no reliable subject to anchor on)', async () => {
    const ctx = makeCtx([parsedFile('- Keep functions small.\n- Prefer large comprehensive functions.\n')]);
    let calls = 0;
    const spy: NliScorer = async () => {
      calls += 1;
      return 0.99;
    };
    const d = await checkSemanticConflict(ctx, spy);
    expect(d.length).toBe(0);
    expect(calls).toBe(0); // 백틱 대상 없음 → 산문 NLI는 FP 근원이라 제외
  });

  it('does not even score unrelated-topic pairs', async () => {
    const ctx = makeCtx([parsedFile('- Validate external `input`.\n- Log issues with structured `detail`.\n')]);
    let calls = 0;
    const spy: NliScorer = async () => {
      calls += 1;
      return 0.99;
    };
    const d = await checkSemanticConflict(ctx, spy);
    expect(d.length).toBe(0);
    expect(calls).toBe(0); // 대상(input vs detail)이 겹치지 않음
  });

  it('skips pairs already owned by deterministic settingKV (same key)', async () => {
    const ctx = makeCtx([parsedFile('- Use tabs for indentation.\n- Use spaces for indentation.\n')]);
    const spy: NliScorer = async () => 0.99;
    const d = await checkSemanticConflict(ctx, spy);
    expect(d.length).toBe(0); // 둘 다 style.indent → Tier-0가 담당 (referent도 없음)
  });

  it('skips markdown-table rows and long prose (not rule-like; real-corpus FP guard)', async () => {
    const body = `- | Step | Always validate \`inputs\` |\n- Always validate \`inputs\` ${'handle process audit '.repeat(12)}\n`;
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
