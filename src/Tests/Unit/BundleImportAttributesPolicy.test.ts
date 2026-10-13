/**
 * Drift pin: bundled source must not use import attributes.
 *
 * `tsup.config.ts` sets `treeshake: true`, so every chunk goes through a
 * Rollup pass. tsup calls Rollup's `generate()` without
 * `importAttributesKey`, and Rollup 4 defaults that key to `assert`. Any
 * `with { type: 'json' }` in source is therefore rewritten to
 * `assert { type: 'json' }` in `lib/index.cjs` and `lib/index.mjs`. Node 22
 * no longer honours `assert`, so a JSON import that passes every
 * source-level test throws `ERR_IMPORT_ATTRIBUTE_MISSING` in the published
 * package alone.
 *
 * Read JSON with `createRequire(import.meta.url)` instead; Rollup shims
 * `import.meta.url` in the CJS bundle, so that works in both builds.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';

const SELF_URL = import.meta.url;
const SELF_PATH = fileURLToPath(SELF_URL);
const SELF_DIR = path.dirname(SELF_PATH);
const REPO_ROOT = path.join(SELF_DIR, '..', '..', '..');

/** Every source file the build can bundle; tests are never bundled. */
const BUNDLED_SOURCE_GLOB = 'src/**/*.ts';
const UNBUNDLED_SOURCE_GLOB = 'src/Tests/**';

/** Static `with {`/`assert {` or dynamic `with: {`/`assert: {` before `type:`. */
const IMPORT_ATTRIBUTES = /\b(?:with|assert)\s*(?::\s*)?\{\s*type\s*:/;

/**
 * Whether a source text carries import attributes.
 *
 * @param text - Source text.
 * @returns True when the text has an import attribute clause.
 */
function hasImportAttributes(text: string): boolean {
  return IMPORT_ATTRIBUTES.test(text);
}

/**
 * Whether one bundled file carries import attributes.
 *
 * @param relativePath - Path from the repository root.
 * @returns True when the file has an import attribute clause.
 */
function fileHasImportAttributes(relativePath: string): boolean {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  const text = readFileSync(absolutePath, 'utf8');
  return hasImportAttributes(text);
}

/**
 * Every bundled source file, relative to the repository root.
 *
 * @returns Sorted relative paths.
 */
function bundledSources(): readonly string[] {
  const options = { cwd: REPO_ROOT, ignore: UNBUNDLED_SOURCE_GLOB, posix: true };
  const files = globSync(BUNDLED_SOURCE_GLOB, options);
  return files.sort();
}

describe('bundled source import attributes drift pin', () => {
  it.each([
    "import data from './data.json' with { type: 'json' };",
    "import data from './data.json' assert { type: 'json' };",
    "await import('pkg/package.json', { with: { type: 'json' } });",
    "await import('pkg/package.json', { assert: { type: 'json' } });",
  ])('flags an import attribute clause: %s', text => {
    const isFlagged = hasImportAttributes(text);
    expect(isFlagged).toBe(true);
  });

  it.each([
    "await import('pkg/dist/module.js');",
    "requireHere('pkg/package.json');",
    "const settings = { width: { type: 'px' } };",
  ])('ignores code without import attributes: %s', text => {
    const isFlagged = hasImportAttributes(text);
    expect(isFlagged).toBe(false);
  });

  it('scans the bundled tree', () => {
    const files = bundledSources();
    expect(files).toContain('src/index.ts');
    expect(files).toContain('src/Scrapers/Pipeline/Mediator/Browser/BrowserStackCheck.ts');
  });

  it('no bundled source file uses import attributes', () => {
    const files = bundledSources();
    const offenders = files.filter(fileHasImportAttributes);
    expect(offenders).toEqual([]);
  });
});
