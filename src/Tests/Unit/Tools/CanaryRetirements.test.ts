import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';

type Inventory = Record<string, string>;
interface ISnapshot {
  cycles: { count: number };
  guardrails: { canaries: number; canaryFiles?: Inventory; eslintRules: number; anyUsages: number };
  runtimeSummary: { avgFanOut: number; edges: number };
  summary: { files: number };
}
interface IPolicy {
  BROWSER_CANARY_RETIREMENTS: Readonly<Inventory>;
}
const ROOT = process.cwd();
const POLICY_PATH = join(ROOT, 'scripts/decoupling-metrics/lib/canary-retirements.mjs');
const POLICY_URL = pathToFileURL(POLICY_PATH);
const POLICY = (await import(POLICY_URL.href)) as IPolicy;
const RETIRED = 'init-cluster-fn-over-cap.canary.ts';
const ACTIVE = { 'api-cap.canary.ts': 'a'.repeat(64) };
const BEFORE = { ...ACTIVE, [RETIRED]: POLICY.BROWSER_CANARY_RETIREMENTS[RETIRED] };
const GATE = join(ROOT, '.github/scripts/ci/decoupling-compare.sh');
const CREATED: string[] = [];

/**
 * Build a synthetic measurement without checking out or running main.
 * @param inventory - Measured canary filenames and hashes.
 * @returns Minimal complete comparator input.
 */
function snapshot(inventory: Inventory = ACTIVE): ISnapshot {
  const count = Object.keys(inventory).length;
  return {
    cycles: { count: 0 },
    guardrails: { canaries: count, canaryFiles: inventory, eslintRules: 77, anyUsages: 0 },
    runtimeSummary: { avgFanOut: 2, edges: 2 },
    summary: { files: 2 },
  };
}

/**
 * Register an owned temporary directory for cleanup.
 * @returns Directory for this comparison's inputs and summary.
 */
function makeTempRoot(): string {
  const tmp = tmpdir();
  const prefix = join(tmp, 'canary-retirements-');
  const dir = mkdtempSync(prefix);
  CREATED.push(dir);
  return dir;
}

/**
 * Write one comparator input.
 * @param dir - Owned temporary directory.
 * @param name - Input filename.
 * @param data - Synthetic measurement.
 * @returns Input path.
 */
function writeSnapshot(dir: string, name: string, data: ISnapshot): string {
  const file = join(dir, name);
  const content = JSON.stringify(data);
  writeFileSync(file, content);
  return file;
}

/**
 * Exercise the real shell comparator against synthetic measurements.
 * @param base - Earlier measurement.
 * @param head - Proposed measurement.
 * @returns Comparator exit status.
 */
function runSnapshots(base: ISnapshot, head: ISnapshot): number {
  const dir = makeTempRoot();
  const basePath = writeSnapshot(dir, 'base.json', base);
  const headPath = writeSnapshot(dir, 'head.json', head);
  return executeGate(dir, basePath, headPath);
}

/**
 * Compare inventories while holding every other metric constant.
 * @param before - Earlier live canaries.
 * @param after - Proposed live canaries.
 * @returns Comparator exit status.
 */
function runGate(before: Inventory = BEFORE, after: Inventory = ACTIVE): number {
  const base = snapshot(before);
  const head = snapshot(after);
  return runSnapshots(base, head);
}

/**
 * Isolate comparator inputs from the host environment.
 * @param dir - Owned output directory.
 * @param base - Earlier snapshot path.
 * @param head - Proposed snapshot path.
 * @returns Environment with explicit inputs and threshold.
 */
function gateEnvironment(dir: string, base: string, head: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BASE_SNAPSHOT: base,
    HEAD_SNAPSHOT: head,
    GITHUB_STEP_SUMMARY: `${dir}/summary.md`,
    THRESHOLD_PCT: '10',
  };
}

/**
 * Run the comparator with a bounded lifetime.
 * @param dir - Owned output directory.
 * @param base - Earlier snapshot path.
 * @param head - Proposed snapshot path.
 * @returns Numeric exit status; signals and launch failures throw.
 */
function executeGate(dir: string, base: string, head: string): number {
  const env = gateEnvironment(dir, base, head);
  const result = spawnSync('bash', [GATE], { env, encoding: 'utf8', timeout: 10_000 });
  if (result.error) throw result.error;
  if (result.status === null)
    throw new ScraperError('Comparator terminated without an exit status');
  return result.status;
}

afterAll(() => {
  for (const dir of CREATED) rmSync(dir, { recursive: true, force: true });
});

describe('Decoupling browser canary retirement policy', () => {
  it('accepts only the exact retired browser fixture', () => {
    const status = runGate();
    expect(status).toBe(0);
  });
  it('accepts the complete approved browser removal without lowering other counts', () => {
    const before = { ...ACTIVE, ...POLICY.BROWSER_CANARY_RETIREMENTS };
    const status = runGate(before);
    expect(status).toBe(0);
  });
  it('does not waive the same filename with different content', () => {
    const before = { ...ACTIVE, [RETIRED]: 'b'.repeat(64) };
    const status = runGate(before);
    expect(status).toBe(1);
  });
  it.each<Inventory>([{}, { 'replacement.canary.ts': 'c'.repeat(64) }])(
    'rejects a surviving API canary deletion even if a replacement hides the count',
    replacement => {
      const status = runGate(BEFORE, replacement);
      expect(status).toBe(1);
    },
  );
  it('does not grant credit again after the browser fixture is already absent', () => {
    const status = runGate(ACTIVE, {});
    expect(status).toBe(1);
  });
  it.each(['cycles', 'any', 'rules', 'fanout'])('still rejects %s regressions', metric => {
    const base = snapshot(BEFORE);
    const head = snapshot();
    if (metric === 'cycles') head.cycles.count = 1;
    if (metric === 'any') head.guardrails.anyUsages = 1;
    if (metric === 'rules') head.guardrails.eslintRules = 76;
    if (metric === 'fanout') head.runtimeSummary.avgFanOut = 2.201;
    const status = runSnapshots(base, head);
    expect(status).toBe(1);
  });
  it('retains the strict count comparison for legacy snapshots', () => {
    const base = snapshot(BEFORE),
      head = snapshot();
    delete base.guardrails.canaryFiles;
    delete head.guardrails.canaryFiles;
    const status = runSnapshots(base, head);
    expect(status).toBe(1);
  });
  it('fails closed when the inventory disagrees with the count', () => {
    const base = snapshot(BEFORE);
    const head = snapshot();
    head.guardrails.canaries = 2;
    const status = runSnapshots(base, head);
    expect(status).toBe(2);
  });
  it('fails closed for malformed canary hashes', () => {
    const base = snapshot(BEFORE);
    const head = snapshot({ 'api-cap.canary.ts': 'invalid' });
    const status = runSnapshots(base, head);
    expect(status).toBe(2);
  });
});
