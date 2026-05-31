import { encode } from 'gpt-tokenizer';

/**
 * 토큰 수 계산. FROZEN §7: 기본 토크나이저는 정확 토큰 예산 근사용(교체 가능).
 * gpt-tokenizer 기본 인코딩(cl100k)을 사용 — Claude 토큰화와 미세 차이는 예산 추정엔 무방.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}
