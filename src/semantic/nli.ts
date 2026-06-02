import type { Directive } from '../types';

/**
 * 로컬 NLI (opt-in 실험 계층). transformers.js + deberta-v3-base(ONNX), 최초 사용 시 모델 다운로드.
 * zero-shot 베이스라인은 잔여 FP가 있어 info 심각도·opt-in으로만 노출하고, 정밀도는 별도 평가로 추적한다.
 * (프로덕션 정밀도는 FROZEN §5: settingKV 온톨로지 합성쌍 fine-tune.)
 */

export type NliScorer = (a: string, b: string) => Promise<number>; // 대칭 contradiction 확률 0..1

const DEFAULT_MODEL = 'Xenova/nli-deberta-v3-base';
let loaderPromise: Promise<NliScorer | null> | null = null;

function softmax(a: number[]): number[] {
  const m = Math.max(...a);
  const e = a.map((x) => Math.exp(x - m));
  const s = e.reduce((x, y) => x + y, 0);
  return e.map((x) => x / s);
}

async function load(): Promise<NliScorer | null> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const mod: any = await import('@xenova/transformers');
    // RULEWARD_NLI_MODEL: fine-tune한 로컬 모델 디렉토리(절대경로)면 로컬 로딩, 아니면 기본 Xenova HF id.
    const override = process.env.RULEWARD_NLI_MODEL;
    let modelId = DEFAULT_MODEL;
    const fromOpts: Record<string, unknown> = {};
    if (override) {
      const p = await import('node:path');
      mod.env.allowLocalModels = true;
      mod.env.localModelPath = p.dirname(override);
      modelId = p.basename(override);
      fromOpts['local_files_only'] = true;
      fromOpts['quantized'] = false; // optimum export = 비양자화 model.onnx
    }
    const tok: any = await mod.AutoTokenizer.from_pretrained(modelId, fromOpts);
    const model: any = await mod.AutoModelForSequenceClassification.from_pretrained(modelId, fromOpts);
    const id2label: Record<string, string> = model.config.id2label ?? {};
    const contraIdx = Number(Object.entries(id2label).find(([, v]) => /contradict/i.test(String(v)))?.[0] ?? 0);
    const one = async (p: string, h: string): Promise<number> => {
      const out = await model(await tok(p, { text_pair: h }));
      return softmax([...out.logits.data] as number[])[contraIdx] ?? 0;
    };
    return async (a, b) => Math.max(await one(a, b), await one(b, a));
  } catch {
    return null; // 모델 로드 실패 → NLI 계층 비활성(결정론 결과만)
  }
}

/** 메모이즈된 NLI 스코러. 미가용 시 null. */
export function getNliScorer(): Promise<NliScorer | null> {
  if (!loaderPromise) loaderPromise = load();
  return loaderPromise;
}

function cap(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
function lcfirst(s: string): string {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}

/** 명령/지시문을 NLI가 잘 다루는 정책 서술문으로 변환 (DEEP-DIVE §B.3). */
export function declarativize(normalized: string, directive: Directive): string {
  const t = normalized.replace(/\s+/g, ' ').replace(/[.]+$/, '').trim();
  if (!t) return '';
  switch (directive) {
    case 'MUST':
      return `It is required to ${lcfirst(t)}.`;
    case 'SHOULD':
      return `It is recommended to ${lcfirst(t)}.`;
    case 'MAY':
      return `It is optional to ${lcfirst(t)}.`;
    case 'MUST_NOT':
    case 'SHOULD_NOT':
      return `${cap(t)}.`; // 이미 부정어 포함(never/avoid/...)
    default:
      return `${cap(t)}.`;
  }
}
