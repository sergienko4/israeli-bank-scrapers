/**
 * Regression coverage for the ESLint-rule ratchet's applied-config walk.
 *
 * The decoupling metric must count rules that `eslint.config.mjs` actually
 * applies. A cluster can stop applying in two ways — the import is removed,
 * or the import stays while the spread that used it is deleted — and both must
 * stop contributing to the ratchet. Counting the directory hides the first;
 * following imports alone hides the second.
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
});
