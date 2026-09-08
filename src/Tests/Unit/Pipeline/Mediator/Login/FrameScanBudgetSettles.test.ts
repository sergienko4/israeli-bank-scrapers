/**
 * A frame scan that hangs must still settle.
 *
 * <p>{@link safeScanFrame} races a frame's error discovery against a
 * budget, so a single unresponsive iframe cannot stall the login phase.
 * The budget only protects anything if it can actually fire.
 *
 * <p>This has to run in a child process. Inside Jest the defect is
 * undetectable by construction: Jest's own timers and handles keep the
 * event loop busy, so even a timer that has told Node to ignore it fires
 * on schedule and the race settles. The failure needs the condition every
 * consumer has and no in-process test can produce — the library being the
 * only thing left to run.
 *
 * <p>Before the fix this probe printed nothing and exited 0: the scan was
 * abandoned mid-race, silently. That is issue #552 reproduced in three
 * seconds, with no browser and no bank.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../../');
const FRAME_SCAN_MODULE = join(REPO_ROOT, 'src/Scrapers/Pipeline/Mediator/Login/LoginFrameScan.js');

/** Printed by the probe only if the race settled. */
const SETTLED_MARKER = 'SETTLED';

/** Budget is 3s; tsx start-up and a slow runner need generous headroom. */
const PROBE_TIMEOUT_MS = 30_000;

/**
 * The probe: one hung frame scan, and nothing else holding the loop open.
 *
 * <p>No keepalive timer, no open handle, no second await — anything of the
 * kind would keep the process alive on its own and mask exactly the defect
 * under test.
 */
const PROBE_SOURCE = `
import { safeScanFrame } from ${JSON.stringify(FRAME_SCAN_MODULE)};

const hungMediator = { discoverErrors: () => new Promise(() => {}) };

safeScanFrame(hungMediator, {}).then(scan => {
  console.log('${SETTLED_MARKER}', JSON.stringify(scan));
});
`;

/**
 * Resolve the TypeScript runner, spawned through `process.execPath` so the
 * probe runs the same way on every platform rather than through a shell
 * wrapper that does not exist on Windows.
 *
 * @returns Absolute path to the tsx CLI entry point.
 */
function resolveTsxCli(): string {
  const require = createRequire(import.meta.url);
  return require.resolve('tsx/cli');
}

/**
 * Run the probe in a process of its own and return everything it printed.
 *
 * @param workDir - Scratch directory to write the probe into.
 * @returns Combined stdout and stderr of the child.
 */
function runProbe(workDir: string): string {
  const probePath = join(workDir, 'probe.ts');
  writeFileSync(probePath, PROBE_SOURCE, 'utf8');
  const runner = resolveTsxCli();
  const child = spawnSync(process.execPath, [runner, probePath], {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
  });
  return `${child.stdout}${child.stderr}`;
}

describe('safeScanFrame budget', () => {
  let workDir = '';

  beforeAll(() => {
    const tempRoot = tmpdir();
    const prefix = join(tempRoot, 'frame-scan-budget-');
    workDir = mkdtempSync(prefix);
  });

  afterAll(() => {
    rmSync(workDir, { force: true, recursive: true });
  });

  it(
    '[SCAN-1] settles a hung scan even when nothing else keeps the process alive',
    () => {
      const output = runProbe(workDir);
      expect(output).toContain(SETTLED_MARKER);
    },
    PROBE_TIMEOUT_MS,
  );
});
