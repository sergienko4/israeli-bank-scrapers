import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/Index.ts'],
  format: ['cjs', 'esm'],
  outDir: 'lib',
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  splitting: false,
  treeshake: true,
  tsconfig: './tsconfig.build.json',
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.mjs' }),
  platform: 'node',
  target: 'node22',
});
