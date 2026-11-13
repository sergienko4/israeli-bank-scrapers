/**
 * The cleanup warning, end to end through the real executor.
 *
 * <p>`reportCleanupFailure` is unit-tested directly elsewhere; this suite proves
 * the executor's own catch actually calls it. The run writes its real
 * `pipeline.log`, which is read only after the run's descriptor has closed, when
 * the file is complete — so "no record on success" is a fact, not a timing guess.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getDebugByName } from '../../../../Scrapers/Pipeline/Logging/Debug.js';
import type { IFileLease } from '../../../../Scrapers/Pipeline/Logging/FileLease.js';
import {
  getActiveRootFileLeaseForTest,
  getRootLogger,
} from '../../../../Scrapers/Pipeline/Logging/RootLogger.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { resetTraceConfigCache } from '../../../../Scrapers/Pipeline/Types/TraceConfig.js';
import type { DisposeFn, ExecFn } from './CleanupFixtures.js';
import {
  mediatorPhase,
  passThroughPhase,
  rejectingDispose,
  resolvingDispose,
  run,
  SECRET,
} from './CleanupFixtures.js';
import { awaitLeaseClosed } from './LogDrain.js';
import { SimplePhase } from './SimplePhase.js';

const FLUSH_DEADLINE_MS = 8000;
const RUN_ID_SHAPE = /^\d{2}-\d{2}-\d{4}_\d{8}$/;
const SENTINEL = 'cleanup-oracle-sentinel';
const TMP_BASE = os.tmpdir();
const ROOT_PREFIX = path.join(TMP_BASE, 'cleanup-oracle-');
const LOG = getDebugByName('cleanup-oracle');

/** One line of a retained `pipeline.log`. */
interface IRetainedLine {
  readonly msg: string;
  readonly event?: string;
  readonly bank?: string;
  readonly runId?: string;
}

/**
 * A phase that logs one line and keeps its run's descriptor lease, so the test
 * can tell when the run's file is complete.
 * @param held - Where the run's lease is kept.
 * @returns The phase.
 */
function leaseKeepingPhase(held: IFileLease[]): SimplePhase {
  /**
   * Log a sentinel line and keep the lease of the file it went to.
   * @param _ctx - Unused.
   * @param input - The context to pass through.
   * @returns The context, unchanged.
   */
  const keep: ExecFn = (_ctx, input) => {
    LOG.info(SENTINEL);
    const lease = getActiveRootFileLeaseForTest();
    if (lease !== false) held.push(lease);
    const next = succeed(input);
    return Promise.resolve(next);
  };
  return new SimplePhase('api-direct-call', keep);
}

/**
 * Parse every `pipeline.log` under a runs root.
 * @param root - The runs root.
 * @returns Every retained line.
 */
function readRetainedLines(root: string): IRetainedLine[] {
  const logsDir = path.join(root, 'pipeline');
  const entries = fs.readdirSync(logsDir, { recursive: true }) as string[];
  const files = entries.filter(name => name.endsWith('pipeline.log'));
  const paths = files.map(name => path.join(logsDir, name));
  const texts = paths.map(file => fs.readFileSync(file, 'utf8'));
  const lines = texts.flatMap(text => text.split('\n').filter(Boolean));
  return lines.map(line => JSON.parse(line) as IRetainedLine);
}

/**
 * Run the real executor with forensic capture and return what its run retained.
 * @param root - A private runs root.
 * @param dispose - The dispose hook the mediator carries.
 * @returns The lines the run wrote.
 */
async function runAndReadLog(root: string, dispose: DisposeFn): Promise<IRetainedLine[]> {
  const held: IFileLease[] = [];
  const phases = [leaseKeepingPhase(held), mediatorPhase(dispose), passThroughPhase()];
  const result = await run(phases);
  expect(result.success).toBe(true);
  expect(held).toHaveLength(1);
  const deadline = Date.now() + FLUSH_DEADLINE_MS;
  const isClosed = await awaitLeaseClosed(held[0], deadline);
  expect(isClosed).toBe(true);
  return readRetainedLines(root);
}

describe('PipelineExecutor — the cleanup warning reaches the execution’s own log', () => {
  const saved = { forensic: process.env.FORENSIC_TRACE, root: process.env.RUNS_ROOT };
  const current = { root: '' };

  beforeEach(() => {
    current.root = fs.mkdtempSync(ROOT_PREFIX);
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = current.root;
    resetTraceConfigCache();
  });

  afterEach(() => {
    if (saved.forensic === undefined) delete process.env.FORENSIC_TRACE;
    else process.env.FORENSIC_TRACE = saved.forensic;
    if (saved.root === undefined) delete process.env.RUNS_ROOT;
    else process.env.RUNS_ROOT = saved.root;
    resetTraceConfigCache();
    getRootLogger();
    fs.rmSync(current.root, { recursive: true, force: true });
  });

  it('[CLN-8] a rejected disposal writes exactly one cleanup-failed record for its own run', async () => {
    const dispose = rejectingDispose();
    const lines = await runAndReadLog(current.root, dispose);
    const warnings = lines.filter(line => line.event === 'cleanup-failed');
    const sentinel = lines.filter(line => line.msg === SENTINEL);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].bank).toBe('beinleumi');
    expect(warnings[0].runId).toMatch(RUN_ID_SHAPE);
    expect(warnings[0].runId).toBe(sentinel[0].runId);
    const written = JSON.stringify(warnings[0]);
    expect(written).not.toContain(SECRET);
  });

  it('[CLN-9] a disposal that succeeds writes no cleanup-failed record', async () => {
    const dispose = resolvingDispose();
    const lines = await runAndReadLog(current.root, dispose);
    const warnings = lines.filter(line => line.event === 'cleanup-failed');
    const sentinel = lines.filter(line => line.msg === SENTINEL);
    expect(sentinel).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });
});
