/**
 * Regression coverage for the ESLint-rule ratchet's applied-config walk.
 *
 * The decoupling metric must count rules that `eslint.config.mjs` actually
 * applies. A cluster can stop applying in three ways — the import is removed,
 * the import stays while the spread that used it is deleted, or the module is
 * kept alive only by a metadata re-export — and all three must stop
 * contributing to the ratchet. Counting the directory hides the first;
 * following imports alone hides the second; following every re-export hides
 * the third.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const GUARDRAILS_PATH = join(ROOT, 'scripts/decoupling-metrics/lib/guardrails.mjs');
const GUARDRAILS_URL = pathToFileURL(GUARDRAILS_PATH);

/** Shape of the metrics module used by this spec. */
interface IGuardrailsModule {
  readonly guardrails: (root: string, files: readonly string[]) => { readonly eslintRules: number };
}

const GUARDRAILS = (await import(GUARDRAILS_URL.href)) as IGuardrailsModule;

/** Temporary roots owned by this spec. */
const CREATED: string[] = [];

/**
 * Create an owned temporary repository root.
 * @returns Directory used as the metrics root.
 */
function makeRoot(): string {
  const tmp = tmpdir();
  const prefix = join(tmp, 'guardrails-reachability-');
  const dir = mkdtempSync(prefix);
  CREATED.push(dir);
  return dir;
}

/**
 * Write one module under the temporary root.
 * @param root - Owned temporary root.
 * @param relative - Module path relative to the root.
 * @param source - Module source.
 * @returns Always true.
 */
function writeModule(root: string, relative: string, source: string): true {
  const file = join(root, relative);
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, source);
  return true;
}

/**
 * Build one config block declaring an error-level rule.
 * @param ruleName - Rule name to declare.
 * @returns Config block expression.
 */
function ruleBlock(ruleName: string): string {
  return `  {\n    rules: {\n      '${ruleName}': 'error',\n    },\n  },`;
}

/**
 * Build a cluster module exporting one error-level rule.
 * @param ruleName - Rule name to declare.
 * @returns ES module source.
 */
function clusterSource(ruleName: string): string {
  return `export const BLOCKS = [\n${ruleBlock(ruleName)}\n];\n`;
}

/**
 * Write a flat-config entry whose transitive imports declare two rules.
 * @param root - Owned temporary root.
 * @returns Always true.
 */
function writeConnectedTree(root: string): true {
  writeModule(
    root,
    'eslint.config.mjs',
    "import { BLOCKS } from './eslint/clusters/Connected.mjs';\nexport default [...BLOCKS];\n",
  );
  writeModule(
    root,
    'eslint/clusters/Connected.mjs',
    `import { NESTED } from '../rules/Nested.mjs';\nexport const BLOCKS = [\n${ruleBlock('connected-rule')}\n  ...NESTED,\n];\n`,
  );
  writeModule(
    root,
    'eslint/rules/Nested.mjs',
    `export const NESTED = [\n${ruleBlock('nested-rule')}\n];\n`,
  );
  return true;
}

/**
 * Leave a cluster module on disk without importing it from the entry.
 * @param root - Owned temporary root.
 * @returns Always true.
 */
function writeDisconnectedCluster(root: string): true {
  const source = clusterSource('orphan-rule');
  writeModule(root, 'eslint/clusters/Disconnected.mjs', source);
  return true;
}

/**
 * Import a cluster whose binding the exported config never uses.
 *
 * This is the second way a rule can go silent: the import survives, the spread
 * that applied it does not. A reachability walk that follows imports alone
 * keeps crediting the module.
 * @param root - Owned temporary root.
 * @returns Always true.
 */
function writeUnusedImportCluster(root: string): true {
  writeModule(
    root,
    'eslint.config.mjs',
    "import { BLOCKS } from './eslint/clusters/Connected.mjs';\nimport { UNUSED } from './eslint/clusters/Unused.mjs';\nexport default [...BLOCKS];\n",
  );
  const source = clusterSource('unused-rule');
  writeModule(root, 'eslint/clusters/Unused.mjs', source);
  return true;
}

/**
 * Build a module that exports metadata beside a block the config never uses.
 *
 * This is the compatibility shape: the metadata export survives, the block it
 * used to accompany does not, and the named re-export still mentions the file.
 * @param ruleName - Rule name to declare in the unused block.
 * @returns ES module source.
 */
function metadataSource(ruleName: string): string {
  return `export const metadata = { id: 'compatibility' };\nexport const BLOCKS = [\n${ruleBlock(ruleName)}\n];\n`;
}

/**
 * Re-export a module's metadata without applying its blocks.
 *
 * `export { metadata } from` exposes a name the default configuration never
 * reads. A compatibility re-export left behind after a block is removed must
 * not keep that block's rules in the count.
 * @param root - Owned temporary root.
 * @returns Always true.
 */
function writeMetadataReexportEntry(root: string): true {
  writeModule(
    root,
    'eslint.config.mjs',
    "export { metadata } from './eslint/clusters/Metadata.mjs';\nexport default [];\n",
  );
  const source = metadataSource('metadata-rule');
  writeModule(root, 'eslint/clusters/Metadata.mjs', source);
  return true;
}

/**
 * Apply a config through `export { default }` at the entry.
 *
 * A default re-export is how a config can hand over its blocks without a local
 * spread, so it must keep the target's rules in the count.
 * @param root - Owned temporary root.
 * @returns Always true.
 */
function writeDefaultReexportEntry(root: string): true {
  writeModule(
    root,
    'eslint.config.mjs',
    "export { default } from './eslint/clusters/DefaultBlocks.mjs';\n",
  );
  writeModule(
    root,
    'eslint/clusters/DefaultBlocks.mjs',
    `export default [\n${ruleBlock('default-rule')}\n];\n`,
  );
  return true;
}

/**
 * Route a block through a barrel that also re-exports metadata.
 *
 * The default barrel re-export is legitimate and must keep applying; the
 * metadata re-export beside it must not pull in a second module's rules.
 * @param root - Owned temporary root.
 * @returns Always true.
 */
function writeBarrelWithMetadata(root: string): true {
  writeModule(
    root,
    'eslint.config.mjs',
    "import { BLOCKS } from './eslint/clusters/Barrel.mjs';\nexport default [...BLOCKS];\n",
  );
  writeModule(
    root,
    'eslint/clusters/Barrel.mjs',
    "export { default as BLOCKS } from './Applied.mjs';\nexport { metadata } from './Metadata.mjs';\n",
  );
  writeModule(
    root,
    'eslint/clusters/Applied.mjs',
    `import { NESTED } from '../rules/Nested.mjs';\nexport default [\n${ruleBlock('applied-rule')}\n  ...NESTED,\n];\n`,
  );
  writeModule(
    root,
    'eslint/rules/Nested.mjs',
    `export const NESTED = [\n${ruleBlock('nested-rule')}\n];\n`,
  );
  const metadata = metadataSource('metadata-rule');
  writeModule(root, 'eslint/clusters/Metadata.mjs', metadata);
  return true;
}

afterAll(() => {
  for (const dir of CREATED) rmSync(dir, { recursive: true, force: true });
});

describe('Decoupling ESLint-rule ratchet', () => {
  it('counts rules reachable through transitive imports', () => {
    const root = makeRoot();
    writeConnectedTree(root);
    const result = GUARDRAILS.guardrails(root, []);
    expect(result.eslintRules).toBe(2);
  });

  it('ignores a cluster left on disk but no longer imported', () => {
    const root = makeRoot();
    writeConnectedTree(root);
    writeDisconnectedCluster(root);
    const result = GUARDRAILS.guardrails(root, []);
    expect(result.eslintRules).toBe(2);
  });

  it('ignores a cluster imported but not applied by the exported config', () => {
    const root = makeRoot();
    writeConnectedTree(root);
    writeUnusedImportCluster(root);
    const result = GUARDRAILS.guardrails(root, []);
    expect(result.eslintRules).toBe(2);
  });

  it('ignores a module reached only by a metadata re-export', () => {
    const root = makeRoot();
    writeMetadataReexportEntry(root);
    const result = GUARDRAILS.guardrails(root, []);
    expect(result.eslintRules).toBe(0);
  });

  it('keeps a default re-export at the entry', () => {
    const root = makeRoot();
    writeDefaultReexportEntry(root);
    const result = GUARDRAILS.guardrails(root, []);
    expect(result.eslintRules).toBe(1);
  });

  it('keeps a default barrel re-export but ignores metadata beside it', () => {
    const root = makeRoot();
    writeBarrelWithMetadata(root);
    const result = GUARDRAILS.guardrails(root, []);
    expect(result.eslintRules).toBe(2);
  });
});
