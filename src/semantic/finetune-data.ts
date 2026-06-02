/**
 * NLI fine-tune 데이터 생성 (FROZEN §5).
 * settingKV 온톨로지의 닫힌-도메인 키에서 합성 명령문-쌍을 라벨과 함께 생성한다:
 *   같은 키·다른 값 → contradiction,  같은 키·값·다른 표현 → entailment,  다른 키 → neutral.
 * zero-shot deberta 베이스라인(precision ~71%)의 명령문 off-distribution 한계를 메우기 위한 학습셋.
 * 실제 fine-tune은 오프라인(Python/transformers + ONNX export) — docs/nli-finetune.md 참조.
 *
 *   npm run nli:gen-data   → corpus/nli-pairs.jsonl
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

interface Group {
  key: string;
  values: Record<string, string[]>; // value → 동의 표현들(en/ko)
}

const GROUPS: Group[] = [
  { key: 'indent', values: {
    tab: ['use tabs for indentation', 'indent with tabs', '들여쓰기는 탭을 사용한다'],
    space: ['use spaces for indentation', 'indent with spaces', '들여쓰기는 스페이스를 사용한다'],
  } },
  { key: 'quotes', values: {
    single: ['use single quotes for strings', 'prefer single quotes', '문자열에 작은따옴표를 쓴다'],
    double: ['use double quotes for strings', 'prefer double quotes', '문자열에 큰따옴표를 쓴다'],
  } },
  { key: 'semicolons', values: {
    required: ['always terminate statements with semicolons', 'require semicolons'],
    forbidden: ['never use semicolons', 'omit semicolons'],
  } },
  { key: 'exports', values: {
    named: ['prefer named exports', 'use named exports only', 'avoid default exports'],
    default: ['prefer a default export', 'use default exports'],
  } },
  { key: 'async', values: {
    asyncAwait: ['prefer async/await', 'use async/await for asynchronous code'],
    promises: ['prefer raw promise chains', 'use .then() chains'],
    callbacks: ['use callbacks for asynchronous work'],
  } },
  { key: 'errors', values: {
    throw: ['throw exceptions on errors', 'raise an exception on failure'],
    result: ['return result objects instead of throwing', 'return error values rather than exceptions'],
  } },
  { key: 'naming', values: {
    camel: ['name variables in camelCase', 'use camelCase for identifiers'],
    snake: ['name variables in snake_case', 'use snake_case for identifiers'],
  } },
  { key: 'comments', values: {
    avoid: ['avoid comments; code should be self-documenting', 'minimize inline comments'],
    document: ['document every function with a comment', 'add explanatory comments to functions'],
  } },
  { key: 'functions', values: {
    small: ['keep functions small and focused', 'functions should do exactly one thing'],
    large: ['prefer large comprehensive functions that handle every case'],
  } },
  { key: 'testing', values: {
    tdd: ['write tests before writing code', 'follow test-driven development'],
    after: ['write tests after the implementation is done'],
  } },
];

type Label = 'contradiction' | 'entailment' | 'neutral';
interface Pair { premise: string; hypothesis: string; label: Label }

function cap(s: string): string {
  return s ? `${s[0]!.toUpperCase()}${s.slice(1)}.` : s;
}

function generate(): Pair[] {
  const pairs: Pair[] = [];

  for (const g of GROUPS) {
    const vals = Object.keys(g.values);
    // contradiction: 같은 키, 다른 값
    for (let i = 0; i < vals.length; i++) {
      for (let j = i + 1; j < vals.length; j++) {
        for (const a of g.values[vals[i]!]!) {
          for (const b of g.values[vals[j]!]!) {
            pairs.push({ premise: cap(a), hypothesis: cap(b), label: 'contradiction' });
          }
        }
      }
    }
    // entailment: 같은 키·값, 다른 표현
    for (const v of vals) {
      const ph = g.values[v]!;
      for (let i = 0; i < ph.length; i++) {
        for (let j = i + 1; j < ph.length; j++) {
          pairs.push({ premise: cap(ph[i]!), hypothesis: cap(ph[j]!), label: 'entailment' });
        }
      }
    }
  }

  // neutral: 다른 키끼리 (각 키의 표현들을 교차 샘플)
  for (let i = 0; i < GROUPS.length; i++) {
    for (let j = i + 1; j < GROUPS.length; j++) {
      const ai = Object.values(GROUPS[i]!.values).flat();
      const aj = Object.values(GROUPS[j]!.values).flat();
      for (let k = 0; k < Math.min(2, ai.length, aj.length); k++) {
        pairs.push({ premise: cap(ai[k]!), hypothesis: cap(aj[k]!), label: 'neutral' });
      }
    }
  }

  // 대칭 보강(premise/hypothesis swap)
  const sym = pairs.map((p) => ({ premise: p.hypothesis, hypothesis: p.premise, label: p.label }));
  return [...pairs, ...sym];
}

const pairs = generate();
const counts = pairs.reduce<Record<string, number>>((a, p) => ((a[p.label] = (a[p.label] ?? 0) + 1), a), {});
mkdirSync('corpus', { recursive: true });
const out = path.join('corpus', 'nli-pairs.jsonl');
writeFileSync(out, `${pairs.map((p) => JSON.stringify(p)).join('\n')}\n`);
console.log(`generated ${pairs.length} pairs → ${out}`);
console.log(`labels: ${JSON.stringify(counts)}`);
console.log('실제 fine-tune은 docs/nli-finetune.md 참조(Python/transformers → ONNX).');
