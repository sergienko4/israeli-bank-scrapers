/**
 * ReDoS guard for the fixture redactor and the `fixtures-pii` audit gate
 * (`scripts/audit-fixtures-pii.cjs`).
 *
 * A rule whose lookbehind ends in `\s*` rescans a whitespace run backwards
 * at every position inside it, so a long run turns the scan quadratic.
 * V8's regexp optimizer usually hides this by skipping positions where the
 * match cannot start, but not in every process: a cold Jest worker ran
 * such rules unoptimized at seconds per scan. So the probe runs in a child
 * process with `--no-regexp-optimization`, the worst case made
 * deterministic, and every scan on both sides must stay linear in it.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const REDACTOR_PATH = join(REPO_ROOT, 'src/Tests/Integration/Tools/PiiRedactor.ts');
const REDACTOR_URL = pathToFileURL(REDACTOR_PATH);
const GATE_PATH = join(REPO_ROOT, 'scripts/audit-fixtures-pii.cjs');
const GATE_URL = pathToFileURL(GATE_PATH);

/** Run length: seconds for a quadratic rule, milliseconds for a linear one. */
const RUN_LENGTH = 20_000;
/** Budget per full scan, far above the linear cost, far below the quadratic. */
const BUDGET_MS = 500;
/** Child start-up through the TypeScript loader needs generous headroom. */
const PROBE_TIMEOUT_MS = 60_000;
/** Printed by the probe in front of its JSON result. */
const RESULT_MARKER = 'LINEARITY:';

/**
 * The probe: each whitespace run, bare and between a client-address key and
 * its value, through the whole redactor and the whole gate. It prints only
 * the side, the shape and the time of each scan over budget, never a text.
 */
const PROBE_SOURCE = `
import { redactPii } from ${JSON.stringify(REDACTOR_URL.href)};
import gate from ${JSON.stringify(GATE_URL.href)};

const scans = [['redactor', redactPii], ['gate', gate.auditText]];
const runs = [['space', ' '], ['newline', '\\n'], ['tab', '\\t']];
const slow = [];
for (const [name, ch] of runs) {
  const run = ch.repeat(${String(RUN_LENGTH)});
  const shapes = [['bare ' + name, 'x' + run + 'y'], [name + ' after a key', 'clientIp =' + run + '203.0.113.5']];
  for (const [shape, input] of shapes) {
    for (const [side, scan] of scans) {
      const start = performance.now();
      scan(input);
      const ms = Math.round(performance.now() - start);
      if (ms > ${String(BUDGET_MS)}) slow.push(side + ': ' + shape + ' run took ' + ms + 'ms');
    }
  }
}
console.log('${RESULT_MARKER}' + JSON.stringify(slow));
`;

/**
 * The TypeScript loader as a file URL for `--import`. The tsx CLI would
 * relaunch Node and drop the V8 flag, so Node is spawned directly with the
 * loader instead, through `process.execPath` to stay shell-free.
 *
 * @returns File URL of the tsx ESM loader.
 */
function tsxLoaderUrl(): string {
  const require = createRequire(import.meta.url);
  const loaderPath = require.resolve('tsx');
  return pathToFileURL(loaderPath).href;
}

/**
 * Run the probe with the regexp optimizer off and return its result line.
 *
 * @param workDir - Scratch directory to write the probe into.
 * @returns The probe's stdout and stderr.
 */
function runProbe(workDir: string): string {
  const probePath = join(workDir, 'probe.ts');
  writeFileSync(probePath, PROBE_SOURCE, 'utf8');
  const args = ['--no-regexp-optimization', '--import', tsxLoaderUrl(), probePath];
  const child = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS });
  return `${child.stdout}${child.stderr}`;
}

/**
 * The scans the probe reported over budget.
 *
 * @param output - The probe's combined output.
 * @returns Each slow scan, or the raw output when no result line was printed.
 */
function slowScans(output: string): readonly string[] {
  const line = output.split('\n').find(text => text.startsWith(RESULT_MARKER));
  if (line === undefined) return [`probe printed no result: ${output}`];
  const json = line.slice(RESULT_MARKER.length);
  return JSON.parse(json) as readonly string[];
}

describe('PII rule linearity on whitespace runs', () => {
  let workDir = '';

  beforeAll(() => {
    const tempRoot = tmpdir();
    const prefix = join(tempRoot, 'pii-linearity-');
    workDir = mkdtempSync(prefix);
  });

  afterAll(() => {
    if (workDir) rmSync(workDir, { force: true, recursive: true });
  });

  it(
    'scans every whitespace run in linear time on both sides, unoptimized',
    () => {
      const output = runProbe(workDir);
      const slow = slowScans(output);
      expect(slow).toEqual([]);
    },
    PROBE_TIMEOUT_MS,
  );
});
