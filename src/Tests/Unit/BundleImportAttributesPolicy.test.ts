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
 *
 * The check parses each file, so a comment, a string or an object that only
 * looks like an attribute clause is not one, and a clause is found however
 * it is spelled.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import * as ts from 'typescript';

const SELF_URL = import.meta.url;
const SELF_PATH = fileURLToPath(SELF_URL);
const SELF_DIR = path.dirname(SELF_PATH);
const REPO_ROOT = path.join(SELF_DIR, '..', '..', '..');

/** Every source file the build can bundle; tests are never bundled. */
const BUNDLED_SOURCE_GLOB = 'src/**/*.ts';
const UNBUNDLED_SOURCE_GLOB = 'src/Tests/**';

/**
 * Whether a node is a static import or re-export with a `with`/`assert`
 * clause.
 *
 * @param node - Any node.
 * @returns True when the declaration carries attributes.
 */
function isStaticWithAttributes(node: ts.Node): boolean {
  const isDeclaration = ts.isImportDeclaration(node) || ts.isExportDeclaration(node);
  return isDeclaration && node.attributes !== undefined;
}

/**
 * Whether a node is an `import()` call with an options argument. Its only
 * option is the attribute bag, and a variable can hold one, so any second
 * argument counts.
 *
 * @param node - Any node.
 * @returns True when the call passes options.
 */
function isDynamicWithOptions(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const isImportCall = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  return isImportCall && node.arguments.length > 1;
}

/**
 * Whether a node or any node below it carries import attributes.
 *
 * @param node - Root of the subtree.
 * @returns True when some node in it does.
 */
function treeHasAttributes(node: ts.Node): boolean {
  if (isStaticWithAttributes(node) || isDynamicWithOptions(node)) return true;
  return ts.forEachChild(node, treeHasAttributes) ?? false;
}

/**
 * Whether a source text carries import attributes.
 *
 * @param text - Source text.
 * @returns True when the text has an import attribute clause.
 */
function hasImportAttributes(text: string): boolean {
  const source = ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest);
  return treeHasAttributes(source);
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
    "import data from './data.json' with /* json */ { type: 'json' };",
    "import data from './data.json' with { 'type': 'json' };",
    "import data from './data.json' with { mode: 'x', type: 'json' };",
    "export { default } from './data.json' with { type: 'json' };",
    "export * from './data.json' with { type: 'json' };",
    "const options = { with: { type: 'json' } }; await import('pkg/package.json', options);",
  ])('flags an import attribute clause: %s', text => {
    const isFlagged = hasImportAttributes(text);
    expect(isFlagged).toBe(true);
  });

  it.each([
    "await import('pkg/dist/module.js');",
    "requireHere('pkg/package.json');",
    "const settings = { width: { type: 'px' } };",
    "const settings = { with: { type: 'json' } };",
    "const settings = { assert: { type: 'json' } };",
    "// import data from './data.json' with { type: 'json' };",
    "const note = \"import data from './data.json' with { type: 'json' }\";",
    "import data from './data.js';",
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
