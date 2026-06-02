import { defineConfig } from 'tsup';

// 배포 빌드: ESM dist + 라이브러리 타입(index) + CLI(shebang 보존).
// deps/optionalDependencies는 기본 external(런타임 node_modules에서 해석).
export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node18',
  dts: { entry: 'src/index.ts' },
  clean: true,
  sourcemap: false,
  skipNodeModulesBundle: true, // 모든 deps external — 특히 @xenova/transformers(optional, 네이티브) 번들 방지
});
