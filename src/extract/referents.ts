import type { CodeReferent, ReferentKind } from '../types';

/**
 * 코드 referent 추출 (DEEP-DIVE §C.1) — 드리프트 엔진 입력.
 * 신뢰도 게이팅 필수. 백틱 밖 심볼은 채택하지 않는다(영어 단어 오인 방지).
 */

const COMMAND_RE = /^(?:npm|pnpm|yarn)\s+(?:run\s+)?[\w:.-]+$|^(?:npx|make|cargo|go|deno|dotnet|gradle|mvn)\s+[\w:.-]+/i;
// 알려진 파일 확장자만 경로로 인정 — 'io.dropwizard.jobs' 같은 점표기 패키지명 오인 방지.
const KNOWN_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|mdx|ya?ml|toml|xml|html?|css|scss|less|sh|bash|py|go|rs|java|cs|rb|php|sql|txt|env|lock|cfg|ini|gradle|properties|svg|png)$/i;

function classifyToken(v: string): { kind: ReferentKind; confidence: number } {
  const t = v.trim();
  if (COMMAND_RE.test(t)) return { kind: 'command', confidence: 0.9 };
  // 공백 포함 토큰은 경로/심볼이 아님 — 셸 명령(`./mvnw -B package`)이거나 자유 문구.
  if (/\s/.test(t)) {
    if (/^\.?\/?(?:mvnw|gradlew)\b/.test(t) || /^\.\//.test(t)) return { kind: 'command', confidence: 0.6 };
    return { kind: 'concept', confidence: 0.4 };
  }
  if (/^@[\w-]+\//.test(t)) return { kind: 'alias', confidence: 0.8 }; // @scope/... (별칭 또는 스코프 패키지)
  if (t.includes('/') || KNOWN_EXT.test(t)) return { kind: 'path', confidence: 0.85 };
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
    // 순수 영어 'word/word'는 경로가 아니라 구문(and/or, input/output, client/server) — 가짜 referent 차단.
    if (v.length > 2 && !/^https?:/.test(v) && !/^[A-Za-z]+\/[A-Za-z]+$/.test(v)) add('path', v, 0.6);
  }

  return [...found.values()];
}
