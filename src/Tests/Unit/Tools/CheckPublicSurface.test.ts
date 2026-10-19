import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { createTempRepo, writeTempFile } from '../../Helpers/TempRepoTree.js';

const ROOT = process.cwd();
const GATE = join(ROOT, 'scripts/check-public-surface.mjs');
const PREFIX = 'interface Options { enabled: boolean; }\ndeclare const factory: () => Options;\n';
const BASE = `${PREFIX}export { factory, type Options as Settings };\n`;
const SPLIT = `${PREFIX}export type { Options as Settings };\nexport { factory };\n`;
const TREES: string[] = [];

/**
 * Creates both built declaration formats and their reviewed baseline.
 * @param built Declaration output.
 * @returns Fixture root.
 */
function makeTree(built: string): string {
  const root = createTempRepo();
  TREES.push(root);
  writeTempFile(root, 'api-surface.d.ts', BASE);
  writeTempFile(root, 'lib/index.d.ts', built);
  writeTempFile(root, 'lib/index.d.cts', built);
  return root;
}

/**
 * Runs the real gate with CI's read-only baseline policy.
 * @param root Fixture root.
 * @param args Gate arguments.
 * @returns Exit status and diagnostic output.
 */
function runGate(root: string, args: string[] = []): { status: number; output: string } {
  const env = { ...process.env, CI: 'true' };
  const result = spawnSync(process.execPath, [GATE, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  for (const root of TREES.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('public surface export compatibility', () => {
  it('accepts regrouped and reordered exports without rewriting the reviewed snapshot', () => {
    const root = makeTree(SPLIT);
    const result = runGate(root);
    const snapshot = join(root, 'api-surface.d.ts');
    const baseline = readFileSync(snapshot, 'utf8');
    expect(result.status).toBe(0);
    expect(baseline).toBe(BASE);
  });

  it.each([
    SPLIT.replace('Settings', 'Renamed'),
    SPLIT.replace('Options as Settings', 'Options'),
    SPLIT.replace('export type', 'export'),
    SPLIT.replace('enabled: boolean', 'enabled: string'),
    SPLIT.replace('export { factory };', ''),
    `${SPLIT}export { factory as anotherFactory };\n`,
    SPLIT.replace('export { factory };', "export { factory } from './other.js';"),
    SPLIT.replace('export { factory };', 'export { /* reviewed export */ factory };'),
    `${SPLIT}interface Extra { value: number; }\n`,
    // Plain declaration text must never collide with serialized export identities.
    `${PREFIX}["[false,\\"factory\\",\\"factory\\"]","[true,\\"Options\\",\\"Settings\\"]"]\n`,
  ])('rejects an actual API change: %s', built => {
    const root = makeTree(built);
    const result = runGate(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain('PUBLIC API DRIFT');
  });

  it('preserves the byte-exact CJS/ESM parity requirement', () => {
    const root = makeTree(SPLIT);
    writeTempFile(root, 'lib/index.d.cts', BASE);
    const result = runGate(root);
    expect(result.output).toContain('CJS and ESM expose different APIs');
    expect(result.status).toBe(1);
  });

  it('rejects missing and malformed declarations as unverifiable', () => {
    const root = makeTree(`${PREFIX}export {`);
    const malformed = runGate(root);
    const built = join(root, 'lib/index.d.ts');
    rmSync(built);
    const missing = runGate(root);
    expect(malformed.status).toBe(2);
    expect(missing.status).toBe(2);
  });

  it.each([
    SPLIT.replace('export type {', 'export type { type'),
    `${PREFIX}export type { type Options as Settings } from './other.js';\n`,
    `${PREFIX}export type { type Options as Settings };\ninterface Extra {}\n`,
  ])('rejects redundant type-only modifiers as unverifiable: %s', built => {
    const root = makeTree(built);
    const result = runGate(root);
    expect(result.status).toBe(2);
    expect(result.output).toContain('CANNOT VERIFY');
  });

  it('continues refusing automatic baseline updates in CI', () => {
    const root = makeTree(SPLIT);
    const result = runGate(root, ['--update']);
    const snapshot = join(root, 'api-surface.d.ts');
    const baseline = readFileSync(snapshot, 'utf8');
    expect(result.status).toBe(2);
    expect(baseline).toBe(BASE);
  });
});
