/**
 * Ownership of the retained run artefacts while two executions overlap.
 *
 * <p>Both runs go through the production logger and write real `pipeline.log`
 * files. What is asserted is the content of those files — every line a run
 * emitted is in that run's file, no line from the other run is, and each line
 * carries its own `bank` and `runId` — not merely that two folders exist.
 *
 * <p>Run A finishes while B is still parked and B keeps logging afterwards, so
 * A's cleanup is proven unable to retire B's destination.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import { executePipeline } from '../../../../Scrapers/Pipeline/Core/Executor/PipelineExecutor.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import { getDebugByName } from '../../../../Scrapers/Pipeline/Logging/Debug.js';
import type { IFileLease } from '../../../../Scrapers/Pipeline/Logging/FileLease.js';
import {
  getActiveRootFileLeaseForTest,
  getRootLogger,
} from '../../../../Scrapers/Pipeline/Logging/RootLogger.js';
import type { IActionContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  getLogFile,
  getNetworkDumpDir,
  resetTraceConfigCache,
} from '../../../../Scrapers/Pipeline/Types/TraceConfig.js';
import { awaitLeaseClosed, pause } from './LogDrain.js';
import { SimplePhase } from './SimplePhase.js';

const TMP_BASE = os.tmpdir();
const ROOT_PREFIX = path.join(TMP_BASE, 'test-runs-executor-artifacts-');
/**
 * Each test gets its own runs root and nothing is deleted until every descriptor the suite
 * opened has closed: a deleted run folder lets the OS hand its inode and fd number to the
 * next test's log, and a late retirement of the old lease would then close the new one.
 */
const ROOTS: string[] = [];
const CURRENT = { root: '' };
const OPENED_LEASES: IFileLease[] = [];
const CREDENTIALS = { username: 'user', password: 'pass' };
const LINES_PER_HALF = 5;
const LINES_PER_RUN = LINES_PER_HALF * 2;
const FLUSH_DEADLINE_MS = 8000;
const LOG = getDebugByName('artifact-oracle');

type ActionFn = (ctx: IActionContext, input: IActionContext) => Promise<Procedure<IActionContext>>;

/** One barrier: `wait` parks until `open` is called. */
interface IGate {
  readonly wait: () => Promise<true>;
  readonly open: () => true;
}

/** One log line as written to a `pipeline.log`. */
interface ILogLine {
  readonly msg: string;
  readonly bank?: string;
  readonly runId?: string;
}

/** A run's barriers: opened once it has logged its first half, and to let it finish. */
interface IRunGates {
  readonly halfWritten: IGate;
  readonly resume: IGate;
}

/** A run that has started and is parked after logging its first half. */
interface IStartedRun {
  readonly gates: IRunGates;
  readonly result: ReturnType<typeof executePipeline>;
  /** Whether this run's own file descriptor was still open at each check, in order. */
  readonly isLeaseOpen: boolean[];
}

/** The retained logs, keyed by the absolute path of each `pipeline.log`. */
type RetainedLogs = Map<string, ILogLine[]>;

/**
 * Placeholder released until a barrier is armed.
 * @returns True.
 */
function noop(): true {
  return true;
}

/**
 * Build a one-shot barrier.
 * @returns The barrier.
 */
function makeGate(): IGate {
  const release: { open: () => true } = { open: noop };
  const parked = new Promise<true>(resolve => {
    /**
     * Release everything parked on this barrier.
     * @returns True once released.
     */
    release.open = (): true => {
      resolve(true);
      return true;
    };
  });
  /**
   * Park until the barrier opens.
   * @returns Resolves once the barrier is open.
   */
  const wait = (): Promise<true> => parked;
  /**
   * Open the barrier.
   * @returns True once opened.
   */
  const open = (): true => release.open();
  return { wait, open };
}

/**
 * Log `count` tagged lines for a run.
 * @param label - The run's tag.
 * @param half - Which half of the run these belong to.
 * @returns True once written.
 */
function logHalf(label: string, half: string): true {
  for (let i = 0; i < LINES_PER_HALF; i += 1) LOG.info(`${label}-${half}-${String(i)}`);
  return true;
}

/**
 * Whether the running execution's own file descriptor is still open.
 * @returns True while the lease exists and has not been closed.
 */
function isOwnLeaseOpen(): boolean {
  const lease = getActiveRootFileLeaseForTest();
  if (lease !== false) OPENED_LEASES.push(lease);
  return lease !== false && !lease.isClosed;
}

/**
 * The action one run executes: log, park, log again.
 * @param label - The run's tag.
 * @param gates - The run's barriers.
 * @param isLeaseOpen - Where the run records whether its own descriptor is still open.
 * @returns The action.
 */
function loggingAction(label: string, gates: IRunGates, isLeaseOpen: boolean[]): ActionFn {
  /**
   * Log the first half, park, then log the second half.
   * @param _ctx - Unused.
   * @param input - The context to pass through.
   * @returns The context, unchanged.
   */
  const act: ActionFn = async (_ctx, input) => {
    logHalf(label, 'first');
    gates.halfWritten.open();
    await gates.resume.wait();
    const isOpen = isOwnLeaseOpen();
    isLeaseOpen.push(isOpen);
    logHalf(label, 'second');
    return succeed(input);
  };
  return act;
}

/**
 * Start one logging run and wait until it has logged its first half.
 * @param companyId - Target bank.
 * @param label - The run's tag.
 * @returns The run's gates and its still-pending result.
 */
async function startRun(companyId: CompanyTypes, label: string): Promise<IStartedRun> {
  const gates: IRunGates = { halfWritten: makeGate(), resume: makeGate() };
  const isLeaseOpen: boolean[] = [];
  const options = { companyId, startDate: new Date('2024-01-01') } as unknown as ScraperOptions;
  const action = loggingAction(label, gates, isLeaseOpen);
  const phase = new SimplePhase('api-direct-call', action);
  const descriptor: IPipelineDescriptor = { options, phases: [phase] };
  const result = executePipeline(descriptor, CREDENTIALS);
  await gates.halfWritten.wait();
  return { gates, result, isLeaseOpen };
}

/**
 * Parse one `pipeline.log`.
 * @param file - The log's absolute path.
 * @returns Its parsed lines.
 */
function parseLog(file: string): ILogLine[] {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n').filter(Boolean);
  return lines.map(line => JSON.parse(line) as ILogLine);
}

/**
 * Every `pipeline.log` under the runs root, with its parsed lines.
 * @returns Log files keyed by their absolute path.
 */
function readRetainedLogs(): RetainedLogs {
  const found: RetainedLogs = new Map();
  const dir = path.join(CURRENT.root, 'pipeline');
  if (!fs.existsSync(dir)) return found;
  const entries = fs.readdirSync(dir, { recursive: true }) as string[];
  for (const entry of entries.filter(name => name.endsWith('pipeline.log'))) {
    const file = path.join(dir, entry);
    const lines = parseLog(file);
    found.set(file, lines);
  }
  return found;
}

/**
 * How many tagged lines the retained logs hold across both runs.
 * @param logs - The retained logs.
 * @returns The count of lines tagged `run-a-` or `run-b-`.
 */
function countRunLines(logs: RetainedLogs): number {
  const all = [...logs.values()].flat();
  return all.filter(line => /^run-[ab]-/.test(line.msg)).length;
}

/**
 * Poll until both runs' lines are on disk, or the deadline passes.
 * @param deadlineMs - Epoch-ms deadline.
 * @returns True once every expected line is retained.
 */
async function awaitRetained(deadlineMs: number): Promise<boolean> {
  const logs = readRetainedLogs();
  if (countRunLines(logs) >= LINES_PER_RUN * 2) return true;
  if (Date.now() >= deadlineMs) return false;
  await pause();
  return awaitRetained(deadlineMs);
}

/**
 * The files that hold a run's tagged lines, with those lines.
 * @param logs - The retained logs.
 * @param label - The run's tag.
 * @returns One entry per file that contains the tag.
 */
function filesHolding(logs: RetainedLogs, label: string): [string, ILogLine[]][] {
  const held: [string, ILogLine[]][] = [];
  for (const [file, lines] of logs) {
    const own = lines.filter(line => line.msg.startsWith(`${label}-`));
    if (own.length > 0) held.push([file, own]);
  }
  return held;
}

/**
 * Lines of the other run found anywhere in a run's complete retained file.
 * @param logs - The retained logs.
 * @param own - The run whose file is read.
 * @param other - The run whose lines must not appear in it.
 * @returns The foreign lines (empty when the file is clean).
 */
function foreignLinesIn(logs: RetainedLogs, own: string, other: string): ILogLine[] {
  const [holding] = filesHolding(logs, own);
  const whole = logs.get(holding[0]) ?? [];
  return whole.filter(line => line.msg.startsWith(`${other}-`));
}

/**
 * Release A and wait for it, then release B and wait for it.
 * @param a - Run A.
 * @param b - Run B.
 * @returns True once both have finished.
 */
async function finishAThenB(a: IStartedRun, b: IStartedRun): Promise<true> {
  a.gates.resume.open();
  await a.result;
  b.gates.resume.open();
  await b.result;
  return true;
}

/**
 * Run two overlapping executions, A finishing before B, and read the logs.
 * @param bankA - Run A's bank.
 * @param bankB - Run B's bank.
 * @returns The retained logs once both runs' lines are on disk.
 */
async function runOverlapped(bankA: CompanyTypes, bankB: CompanyTypes): Promise<RetainedLogs> {
  const a = await startRun(bankA, 'run-a');
  const b = await startRun(bankB, 'run-b');
  await finishAThenB(a, b);
  await awaitRetained(Date.now() + FLUSH_DEADLINE_MS);
  const logs = readRetainedLogs();
  const retainedCount = countRunLines(logs);
  expect(retainedCount).toBe(LINES_PER_RUN * 2);
  return logs;
}

/**
 * The distinct values of a field across a run's lines.
 * @param lines - The run's lines.
 * @param field - Which field to collect.
 * @returns The distinct values.
 */
function distinct(lines: ILogLine[], field: 'bank' | 'runId'): string[] {
  const values = lines.map(line => String(line[field]));
  return [...new Set(values)];
}

/**
 * Run one action as a single-phase pipeline.
 * @param companyId - Target bank.
 * @param action - The action to run.
 * @returns The pipeline's result.
 */
function runAction(companyId: CompanyTypes, action: ActionFn): ReturnType<typeof executePipeline> {
  const options = { companyId, startDate: new Date('2024-01-01') } as unknown as ScraperOptions;
  const phase = new SimplePhase('api-direct-call', action);
  const descriptor: IPipelineDescriptor = { options, phases: [phase] };
  return executePipeline(descriptor, CREDENTIALS);
}

/**
 * An action that logs, remembers its own file descriptor, then switches capture off.
 * @param held - Where the run's descriptor lease is kept.
 * @returns The action.
 */
function switchOffMidRunAction(held: IFileLease[]): ActionFn {
  /**
   * Log, keep the lease, clear `FORENSIC_TRACE`.
   * @param _ctx - Unused.
   * @param input - The context to pass through.
   * @returns The context, unchanged.
   */
  const act: ActionFn = (_ctx, input) => {
    logHalf('run-a', 'first');
    const lease = getActiveRootFileLeaseForTest();
    if (lease !== false) held.push(lease);
    if (lease !== false) OPENED_LEASES.push(lease);
    process.env.FORENSIC_TRACE = 'false';
    resetTraceConfigCache();
    const done = succeed(input);
    return Promise.resolve(done);
  };
  return act;
}

/**
 * An action that does nothing, so no log line creates the run folder.
 * @param _ctx - Unused.
 * @param input - The context to pass through.
 * @returns The context, unchanged.
 */
function silentAction(
  _ctx: IActionContext,
  input: IActionContext,
): Promise<Procedure<IActionContext>> {
  const done = succeed(input);
  return Promise.resolve(done);
}

/** What a callback that outlived its run found when it touched the run's artefacts. */
interface ILateFindings {
  logFile: string;
  networkDir: string;
  hasLease: boolean;
}

/**
 * An action that starts work inside the run, parked on a barrier that is only
 * opened after the run has finished. Forensic capture stays on throughout.
 * @param release - Barrier opened once the run has resolved.
 * @param found - Where the late work records what it saw.
 * @param late - Where the pending late work is kept so the test can await it.
 * @returns The action.
 */
function lateCallbackAction(release: IGate, found: ILateFindings, late: Promise<true>[]): ActionFn {
  /**
   * Start the late work and return immediately.
   * @param _ctx - Unused.
   * @param input - The context to pass through.
   * @returns The context, unchanged.
   */
  const act: ActionFn = (_ctx, input) => {
    const pending = touchAfterRelease(release, found);
    late.push(pending);
    const done = succeed(input);
    return Promise.resolve(done);
  };
  return act;
}

/**
 * Wait for the barrier, then log and ask for the run's artefact paths.
 * @param release - Barrier opened once the run has resolved.
 * @param found - Where to record what was seen.
 * @returns True once recorded.
 */
async function touchAfterRelease(release: IGate, found: ILateFindings): Promise<true> {
  await release.wait();
  getRootLogger();
  found.logFile = getLogFile();
  found.networkDir = getNetworkDumpDir();
  const lease = getActiveRootFileLeaseForTest();
  found.hasLease = lease !== false;
  return true;
}

describe('PipelineExecutor — retained artefacts under overlap (forensic on)', () => {
  const saved = { forensic: process.env.FORENSIC_TRACE, root: process.env.RUNS_ROOT };

  beforeEach(() => {
    CURRENT.root = fs.mkdtempSync(ROOT_PREFIX);
    ROOTS.push(CURRENT.root);
    process.env.FORENSIC_TRACE = 'true';
    process.env.RUNS_ROOT = CURRENT.root;
    resetTraceConfigCache();
  });

  afterAll(async () => {
    const deadline = Date.now() + FLUSH_DEADLINE_MS;
    const closing = OPENED_LEASES.map(lease => awaitLeaseClosed(lease, deadline));
    await Promise.all(closing);
    for (const root of ROOTS) fs.rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    if (saved.forensic === undefined) delete process.env.FORENSIC_TRACE;
    else process.env.FORENSIC_TRACE = saved.forensic;
    if (saved.root === undefined) delete process.env.RUNS_ROOT;
    else process.env.RUNS_ROOT = saved.root;
    resetTraceConfigCache();
    getRootLogger();
  });

  it.each([
    { name: 'different banks', bankB: CompanyTypes.Discount },
    { name: 'the same bank', bankB: CompanyTypes.Beinleumi },
  ])('[ART-1] each run keeps its own file and every line of it, for $name', async row => {
    const logs = await runOverlapped(CompanyTypes.Beinleumi, row.bankB);
    const [fileA] = filesHolding(logs, 'run-a');
    const [fileB] = filesHolding(logs, 'run-b');
    expect(fileA[1]).toHaveLength(LINES_PER_RUN);
    expect(fileB[1]).toHaveLength(LINES_PER_RUN);
    expect(fileA[0]).not.toBe(fileB[0]);
  });

  it('[ART-2] no file holds a line from the other run', async () => {
    const logs = await runOverlapped(CompanyTypes.Beinleumi, CompanyTypes.Discount);
    const holdingA = filesHolding(logs, 'run-a');
    const holdingB = filesHolding(logs, 'run-b');
    expect(holdingA).toHaveLength(1);
    expect(holdingB).toHaveLength(1);
    const foreignInA = foreignLinesIn(logs, 'run-a', 'run-b');
    const foreignInB = foreignLinesIn(logs, 'run-b', 'run-a');
    expect(foreignInA).toHaveLength(0);
    expect(foreignInB).toHaveLength(0);
  });

  it('[ART-3] every line carries its own bank and one stable runId', async () => {
    const logs = await runOverlapped(CompanyTypes.Beinleumi, CompanyTypes.Discount);
    const [fileA] = filesHolding(logs, 'run-a');
    const [fileB] = filesHolding(logs, 'run-b');
    const banksA = distinct(fileA[1], 'bank');
    const banksB = distinct(fileB[1], 'bank');
    expect(banksA).toEqual(['beinleumi']);
    expect(banksB).toEqual(['discount']);
    const idsA = distinct(fileA[1], 'runId');
    const idsB = distinct(fileB[1], 'runId');
    expect(idsA).toHaveLength(1);
    expect(idsB).toHaveLength(1);
    expect(fileA[1][0].runId).not.toBe(fileB[1][0].runId);
  });

  it('[ART-5] a run still retires its own destination when capture is switched off mid-run', async () => {
    const held: IFileLease[] = [];
    const action = switchOffMidRunAction(held);
    const result = await runAction(CompanyTypes.Beinleumi, action);
    expect(result.success).toBe(true);
    expect(held).toHaveLength(1);
    const deadline = Date.now() + FLUSH_DEADLINE_MS;
    const isClosed = await awaitLeaseClosed(held[0], deadline);
    expect(isClosed).toBe(true);
  });

  it('[ART-6] an unusable runs root gives a failed result, not a rejection from cleanup', async () => {
    const blockerPrefix = path.join(TMP_BASE, 'art-blocker-');
    const privateDir = fs.mkdtempSync(blockerPrefix);
    const blocker = path.join(privateDir, 'not-a-directory');
    fs.writeFileSync(blocker, 'a file where the runs root should be');
    process.env.RUNS_ROOT = blocker;
    resetTraceConfigCache();
    try {
      const result = await runAction(CompanyTypes.Beinleumi, silentAction);
      expect(result.success).toBe(false);
    } finally {
      fs.rmSync(privateDir, { recursive: true, force: true });
    }
  });

  it('[ART-7] a callback that outlives its run cannot reopen the run’s destination', async () => {
    const release = makeGate();
    const found: ILateFindings = { logFile: 'unset', networkDir: 'unset', hasLease: true };
    const late: Promise<true>[] = [];
    const action = lateCallbackAction(release, found, late);
    const result = await runAction(CompanyTypes.Beinleumi, action);
    expect(result.success).toBe(true);
    release.open();
    await Promise.all(late);
    expect(found).toEqual({ logFile: '', networkDir: '', hasLease: false });
  });

  it('[ART-4] a run that finishes first does not close the descriptor of one still running', async () => {
    const a = await startRun(CompanyTypes.Beinleumi, 'run-a');
    const b = await startRun(CompanyTypes.Discount, 'run-b');
    a.gates.resume.open();
    await a.result;
    b.gates.resume.open();
    await b.result;
    expect(b.isLeaseOpen).toEqual([true]);
    expect(a.isLeaseOpen).toEqual([true]);
  });
});
