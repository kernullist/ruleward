import type { Category, SettingKV } from '../types';

/** Galster taxonomy 분류 v1 (DEEP-DIVE §A.5). 키워드 1차 + settingKV 힌트. */

const RULES: Array<[RegExp, Category]> = [
  [/secret|password|token|credential|\bauth\b|injection|sanitiz|escape|vulnerab|보안|취약|인증/, 'security'],
  [/\btest|spec\b|coverage|mock|stub|fixture|테스트|커버리지/, 'test'],
  [/build|compile|bundle|webpack|vite|rollup|빌드|컴파일|번들/, 'build'],
  [/eslint|prettier|\blint|formatter|\bci\b|pipeline|pre-commit|husky|린트|포매터/, 'tooling'],
  [/import|module|layer|architect|dependency|boundary|circular|아키텍처|의존|모듈|레이어/, 'architecture'],
  [/commit|branch|\bpr\b|pull request|review|\bmerge\b|커밋|브랜치|리뷰/, 'process'],
  [/indent|quote|semicolon|naming|\bcase\b|line length|spacing|들여|따옴표|네이밍|스타일/, 'style'],
  [/clean|readable|maintainable|simple|\bdry\b|\bsolid\b|quality|깔끔|가독|유지보수|품질/, 'quality'],
];

export function classifyCategory(normalizedLower: string, settingKV: SettingKV | null): Category {
  if (settingKV) {
    const top = settingKV.key.split('.')[0];
    if (top === 'style' || top === 'naming') return 'style';
    if (top === 'imports' || top === 'module') return 'architecture';
    if (top === 'testing') return 'test';
    if (top === 'commit' || top === 'branch') return 'process';
  }
  const s = normalizedLower.toLowerCase();
  for (const [re, cat] of RULES) {
    if (re.test(s)) return cat;
  }
  return 'context';
}
