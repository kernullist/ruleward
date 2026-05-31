import type { CodeReferent, ReferentKind } from '../types';

/**
 * 코드 referent 추출 (DEEP-DIVE §C.1) — 드리프트 엔진 입력.
 * 신뢰도 게이팅 필수. 백틱 밖 심볼은 채택하지 않는다(영어 단어 오인 방지).
 */

const COMMAND_RE = /^(?:npm|pnpm|yarn)\s+(?:run\s+)?[\w:.-]+$|^(?:npx|make|cargo|go|deno|dotnet|gradle|mvn)\s+[\w:.-]+/i;

function classifyToken(v: string): { kind: ReferentKind; confidence: number } {
  const t = v.trim();
  if (COMMAND_RE.test(t)) return { kind: 'command', confidence: 0.9 };
  if (/^@[\w-]+\//.test(t)) return { kind: 'alias', confidence: 0.8 }; // @scope/... (별칭 또는 스코프 패키지)
  if (t.includes('/') || /\.\w{1,6}$/.test(t) || /^[.~]?\//.test(t)) return { kind: 'path', confidence: 0.85 };
  // CamelCase / PascalCase / snake_case / Foo.bar — 백틱 안에서만 심볼로 인정
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(t) && /[A-Z_]/.test(t) && !/^[A-Z]+$/.test(t)) {
    return { kind: 'symbol', confidence: 0.7 };
  }
  return { kind: 'concept', confidence: 0.45 };
}

export function extractReferents(raw: string): CodeReferent[] {
  const found = new Map<string, CodeReferent>();
  const add = (kind: ReferentKind, value: string, confidence: number): void => {
    const key = `${kind}:${value}`;
    const prev = found.get(key);
    if (!prev || prev.confidence < confidence) found.set(key, { kind, value, confidence });
  };

  // 1) 백틱 스팬 (고신뢰)
  const spanRe = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = spanRe.exec(raw)) !== null) {
    const v = (m[1] ?? '').trim();
    if (!v) continue;
    const { kind, confidence } = classifyToken(v);
    add(kind, v, confidence);
  }

  // 백틱 내용 제거 후 평문 스캔 (중복 방지). 커맨드는 룰파일에서 거의 항상 백틱 안에
  // 있으므로 평문 커맨드 스캔은 생략한다(FP 억제) — 경로만 보수적으로 스캔.
  const outside = raw.replace(/`[^`]+`/g, ' ');

  // 2) 평문 경로 (보수적, 저신뢰)
  const pathRe = /(?:\.{0,2}\/)[\w@./*-]+|\b[\w-]+\/[\w@./*-]+/g;
  while ((m = pathRe.exec(outside)) !== null) {
    const v = m[0].trim();
    if (v.length > 2 && !/^https?:/.test(v)) add('path', v, 0.6);
  }

  return [...found.values()];
}
