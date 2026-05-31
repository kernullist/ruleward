/**
 * Instruction IR + 진단 타입 (FROZEN-v0.3 §2, DEEP-DIVE §A).
 *
 * 용어: 룰파일(입력) → 파싱 → Instruction(원자 지시문, 이 IR의 노드) → Engine의 Check → Diagnostic.
 */

export type Directive = 'MUST' | 'MUST_NOT' | 'SHOULD' | 'SHOULD_NOT' | 'MAY' | 'INFO';
export type Polarity = 'requirement' | 'prohibition' | 'preference' | 'statement';
export type Atomicity = 'atomic' | 'compound' | 'narrative';
export type Loading = 'always' | 'auto-attached' | 'agent-requested' | 'manual';

export type Category =
  | 'style'
  | 'quality'
  | 'architecture'
  | 'build'
  | 'test'
  | 'security'
  | 'tooling'
  | 'context'
  | 'process';

export type ReferentKind = 'path' | 'command' | 'package' | 'symbol' | 'alias' | 'concept';

/** 룰 텍스트가 가리키는 코드 대상(드리프트 엔진 입력). 신뢰도 게이팅 필수. */
export interface CodeReferent {
  kind: ReferentKind;
  value: string;
  confidence: number; // 0..1
}

export type SettingConfType = 'closed' | 'scalar' | 'singleton' | 'set';

/** 키-값으로 환원 가능한 룰 (FROZEN §3 온톨로지). 충돌 Tier-0의 연료. */
export interface SettingKV {
  key: string; // 정규 키, 예: "style.indent"
  value: string; // 정규화된 값
  confType: SettingConfType;
}

export interface Scope {
  globs: string[];
  loading: Loading;
  dirBoundary: string; // 중첩 우선순위 계산용 디렉토리
}

export interface SourceLoc {
  file: string; // 스캔 루트 기준 상대경로
  line: number;
  col?: number;
  endLine?: number;
  headingPath: string[];
}

/** Instruction IR의 한 노드 = 원자 지시문 하나. */
export interface Instruction {
  id: string; // 안정 ID: <file>#<headingPath>#L<line>.<idx>
  source: SourceLoc;
  raw: string; // 원문(클로즈 단위)
  normalized: string; // 공백 정규화·마커 제거
  directive: Directive;
  polarity: Polarity;
  atomicity: Atomicity;
  fromCompound: boolean; // 복문에서 분리돼 나왔는가
  scope: Scope;
  category: Category;
  settingKV: SettingKV | null;
  codeReferents: CodeReferent[];
  tokens: number;
}

export type FileFormat =
  | 'agents'
  | 'claude'
  | 'cursor-mdc'
  | 'copilot'
  | 'windsurf'
  | 'cline'
  | 'unknown';

export interface RuleFile {
  relPath: string; // 스캔 루트 기준 상대경로
  absPath: string;
  format: FileFormat;
  frontmatter: Record<string, unknown>;
  body: string;
  scope: Scope;
}

export interface ParsedFile {
  file: RuleFile;
  instructions: Instruction[];
}
