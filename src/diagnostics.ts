import { createHash } from 'node:crypto';

/** 진단 모델 (FROZEN §2) — felix의 구조화 Violation을 채택, carl의 string[]은 회피. */

export type Severity = 'error' | 'warning' | 'info';
export type EngineName = 'conflict' | 'duplication' | 'bloat' | 'drift';

export interface DiagLoc {
  file: string;
  line?: number;
  endLine?: number;
  col?: number;
}

export interface TextEdit {
  file: string;
  line: number;
  newText: string;
  mode: 'replace' | 'insert' | 'delete';
}

export type Fix =
  | { kind: 'auto'; description: string; edits: TextEdit[] }
  | { kind: 'assisted'; description: string }
  | { kind: 'manual'; description: string; options?: string[] };

export interface Related {
  loc: DiagLoc;
  role: string;
}

export interface Diagnostic {
  checkId: string; // "engine/check"
  engine: EngineName;
  severity: Severity;
  confidence: number; // 0..1
  message: string;
  location: DiagLoc;
  related?: Related[];
  fix?: Fix;
  fingerprint: string; // 런-간 안정 ID
}

export const SEVERITY_LEVEL: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

export function fingerprint(parts: Array<string | number>): string {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}
