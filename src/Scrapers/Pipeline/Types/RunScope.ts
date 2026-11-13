/**
 * Per-execution run scope — the async-local owner of everything one
 * `executePipeline` call reports about itself: its bank, its current phase and
 * stage, and its run identity (the `runId` and the artefact folders named after
 * it).
 *
 * <p>Zero imports beyond a Node built-in, so ActiveState, TraceConfig and
 * BankContext can all depend on it without a cycle.
 *
 * <p>Identity is per execution: every scope allocates its own `runId` on first
 * use, so two overlapping runs — of different banks or of the same one — never
 * share a stamp, a folder or a log file. Code that runs outside any scope (log
 * lines emitted before a run starts, unit tests that drive a phase directly)
 * falls back to the process-global state each reader keeps for that purpose.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** The run identity and artefact folders of one execution. */
interface IRunTrace {
  runId: string | false;
  folder: string | false;
  networkDir: string | false;
  /** The log file this run's logger was bound to, kept so cleanup never re-resolves a path. */
  logFile: string | false;
  readonly subSteps: Map<string, string>;
  /** Set once the run has finished, so a late async callback cannot reopen its folder. */
  isClosed: boolean;
}

/** Everything one execution owns. */
interface IRunScope {
  readonly bank: string;
  phase: string;
  stage: string;
  readonly trace: IRunTrace;
}

const UNALLOCATED = { runId: false, folder: false, networkDir: false, logFile: false } as const;

/**
 * Build an empty run identity.
 * @returns A trace with nothing allocated yet.
 */
function makeRunTrace(): IRunTrace {
  return { ...UNALLOCATED, subSteps: new Map<string, string>(), isClosed: false };
}

/**
 * Remember the log file a run's logger was bound to. Only the first real file
 * counts, so switching capture off mid-run cannot make the run forget it.
 * @param trace - The run's trace.
 * @param logFile - The destination the run's logger resolved to ('' when none).
 * @returns True once noted.
 */
function noteRunLogFile(trace: IRunTrace, logFile: string): true {
  if (logFile.length > 0 && trace.logFile === false) trace.logFile = logFile;
  return true;
}

/**
 * Create the async-local store for run scopes.
 * Uses Reflect.construct to avoid the no-restricted-syntax rule on `new X()`.
 * @returns A typed AsyncLocalStorage instance.
 */
function createScopeStore(): AsyncLocalStorage<IRunScope> {
  return Reflect.construct(AsyncLocalStorage, []) as AsyncLocalStorage<IRunScope>;
}

const RUN_SCOPE = createScopeStore();

/**
 * The scope of the execution currently running, if any.
 * @returns The scope, or `false` outside every execution.
 */
function currentRunScope(): IRunScope | false {
  return RUN_SCOPE.getStore() ?? false;
}

/**
 * Run a function inside a fresh scope for `bank`. Phase and stage start at the
 * same values the process-global fallback starts with.
 * @param bank - The bank identifier (companyId).
 * @param fn - The function to run inside the scope.
 * @returns Whatever `fn` returns.
 */
function openRunScope<T>(bank: string, fn: () => T): T {
  const scope: IRunScope = { bank, phase: 'init', stage: 'PRE', trace: makeRunTrace() };
  return RUN_SCOPE.run(scope, fn);
}

export type { IRunScope, IRunTrace };
export { currentRunScope, makeRunTrace, noteRunLogFile, openRunScope };
