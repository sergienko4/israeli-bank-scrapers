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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';
import * as ts from 'typescript';

const SELF_URL = import.meta.url;
const SELF_PATH = fileURLToPath(SELF_URL);
const SELF_DIR = path.dirname(SELF_PATH);
const REPO_ROOT = path.join(SELF_DIR, '..', '..', '..');

/**
 * Every source file the build can bundle, in any extension the bundler
 * reads. The trees the tsconfig files exclude are never bundled: the tests,
 * and the ESLint canaries, which break rules on purpose.
 */
const BUNDLED_SOURCE_GLOB = 'src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}';
const UNBUNDLED_SOURCE_GLOBS = ['src/Tests/**', 'src/Scrapers/Pipeline/EslintCanaries/**'];

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
 * Whether a source text carries import attributes. The file name picks the
 * grammar, so JSX in a `.tsx` file parses as JSX.
 *
 * @param text - Source text.
 * @param fileName - Name whose extension sets the script kind.
 * @returns True when the text has an import attribute clause.
 */
function hasImportAttributes(text: string, fileName = 'probe.ts'): boolean {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest);
  return treeHasAttributes(source);
}

/**
 * Whether one bundled file carries import attributes.
 *
 * @param relativePath - Path from `root`.
 * @param root - Tree the path is in; the repository by default.
 * @returns True when the file has an import attribute clause.
 */
function fileHasImportAttributes(relativePath: string, root = REPO_ROOT): boolean {
  const absolutePath = path.join(root, relativePath);
  const text = readFileSync(absolutePath, 'utf8');
  return hasImportAttributes(text, relativePath);
}

/**
 * Every bundled source file below `root`, relative to it.
 *
 * @param root - Tree to scan; the repository by default.
 * @returns Sorted relative paths.
 */
function bundledSources(root = REPO_ROOT): readonly string[] {
  const options = { cwd: root, ignore: UNBUNDLED_SOURCE_GLOBS, posix: true };
  const files = globSync(BUNDLED_SOURCE_GLOB, options);
  return files.sort();
}

/** Every extension a source file can have; one probe file is written per extension. */
const SOURCE_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'] as const;

/** Files in trees the build excludes; the scan must skip each. */
const UNBUNDLED_PROBES = ['src/Tests/probe.ts', 'src/Scrapers/Pipeline/EslintCanaries/probe.cjs'];

/** JSX text that only reads like an attribute clause. */
const JSX_TEXT_LOOKALIKE = [
  'const view = <pre>{`x`}',
  "import data from './data.json' with &#123; type: 'json' &#125;",
  '</pre>;',
].join('\n');

/**
 * Write one empty file under `root`.
 *
 * @param root - Tree root.
 * @param relativePath - POSIX path below the root.
 * @returns The absolute path written.
 */
function writeEmptyFile(root: string, relativePath: string): string {
  const filePath = path.join(root, relativePath);
  writeFileSync(filePath, '');
  return filePath;
}

/**
 * Write a probe file per source extension, plus one in each excluded tree.
 *
 * @param root - Tree root.
 * @returns The probe paths the scan must list, sorted.
 */
function writeSourceTree(root: string): readonly string[] {
  const canariesDir = path.join(root, 'src', 'Scrapers', 'Pipeline', 'EslintCanaries');
  const testsDir = path.join(root, 'src', 'Tests');
  for (const dir of [canariesDir, testsDir]) mkdirSync(dir, { recursive: true });
  const probes = SOURCE_EXTENSIONS.map((extension): string => `src/probe.${extension}`);
  for (const probe of [...probes, ...UNBUNDLED_PROBES]) writeEmptyFile(root, probe);
  return probes.sort();
}

describe('bundled source import attributes drift pin', () => {
  let treeRoot = '';

  beforeAll(() => {
    const tempBase = tmpdir();
    const prefix = path.join(tempBase, 'bundle-attributes-');
    treeRoot = mkdtempSync(prefix);
  });

  afterAll(() => {
    rmSync(treeRoot, { recursive: true, force: true });
  });

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

  it('reads JSX text in a .tsx file as text', () => {
    const isFlagged = hasImportAttributes(JSX_TEXT_LOOKALIKE, 'probe.tsx');
    expect(isFlagged).toBe(false);
  });

  it('reads each file with the grammar of its extension', () => {
    const viewPath = path.join(treeRoot, 'view.tsx');
    writeFileSync(viewPath, JSX_TEXT_LOOKALIKE);
    const isFlagged = fileHasImportAttributes('view.tsx', treeRoot);
    expect(isFlagged).toBe(false);
  });

  it('scans every source extension outside the excluded trees', () => {
    const probes = writeSourceTree(treeRoot);
    const files = bundledSources(treeRoot);
    expect(files).toEqual(probes);
  });

  it('scans the bundled tree', () => {
    const files = bundledSources();
    expect(files).toContain('src/index.ts');
    expect(files).toContain('src/Scrapers/Pipeline/Mediator/Browser/BrowserStackCheck.ts');
  });

  it('no bundled source file uses import attributes', () => {
    const files = bundledSources();
    const offenders = files.filter((file): boolean => fileHasImportAttributes(file));
    expect(offenders).toEqual([]);
  });
});
