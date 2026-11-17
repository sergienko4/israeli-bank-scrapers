/**
 * Forensic artefact root — per-bank-run folder for the pipeline log and
 * network response dumps, captured only when the opt-in `FORENSIC_TRACE=true`
 * flag is set. Removes
 * the older patchwork of independent env vars (LOG_FILE / LOG_PATH /
 * LOG_BANK / DUMP_NETWORK_DIR / DUMP_NETWORK_LABEL) that had to be wired up
 * by hand on every run.
 *
 * Layout (created lazily on first use):
 *   <RUNS_ROOT>/pipeline/<bank>/<DDMMYY-HHMMSScc>/
 *     pipeline.log
 *     network/<NNNN>-<METHOD>-<safe-url>.json
 *
 * `<bank>` comes from the execution's run scope. There is no process-global
 * bank: outside a scope no artefact paths are produced. A run is only started
 * after `PipelineExecutor` has validated the company id — there is no run
 * without a bank.
 * `cc` is centiseconds (1/100 s) for sub-second uniqueness across parallel
 * jest invocations.
 *
 * Capture is gated centrally by `FORENSIC_TRACE` (see {@link isForensicTrace}):
 * when the flag is off (default) every artefact getter returns `''` and the
 * writer layer (Pino transport and HTTP capture hooks) no-ops.
 * `LOG_LEVEL` independently controls log verbosity only — it
 * no longer decides whether artefacts land on disk.
 *
 * The root comes from the environment boundary (`RUNS_ROOT`). Folder paths
 * and `runId` are allocated once per run scope, so two overlapping runs never
 * share either.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { BankSlugLower } from './BankSlugs.js';
import type { Brand } from './Brand.js';
import { activeEnvironment } from './Environment.js';
import { currentRunScope, type IRunTrace } from './RunScope.js';
import ensurePrivateRunRoot from './SecureRunRoot.js';
import type { RunStampStr } from './TraceStamp.js';
import { nextRunStamp } from './TraceStamp.js';

/** Forensic-trace active flag. */
type IsForensicTraceActive = Brand<boolean, 'IsForensicTraceActive'>;
/** Absolute run folder path (or empty when off-trace). */
type RunFolderPath = Brand<string, 'RunFolderPath'>;
/** Absolute log file path (or empty). */
type LogFilePath = Brand<string, 'LogFilePath'>;

/** Filename for the pipeline log inside the run folder. */
const PIPELINE_LOG_FILE = 'pipeline.log';
/** Top-level umbrella segment under RUNS_ROOT — fixed for every pipeline run. */
const PIPELINE_SEGMENT = 'pipeline';

/**
 * The run identity the caller belongs to.
 * @returns The running execution's trace, or false outside every execution.
 */
function traceOwner(): IRunTrace | false {
  const scope = currentRunScope();
  return scope ? scope.trace : false;
}

/**
 * Resolve the bank slug of the running execution. Reads only the current run
 * scope, so two overlapping executions cannot observe each other's bank.
 * @returns Bank slug, or empty string outside every execution.
 */
function resolveBankSlug(): BankSlugLower {
  const scope = currentRunScope();
  if (!scope) return '' as BankSlugLower;
  return scope.bank.trim().toLowerCase() as BankSlugLower;
}

/**
 * True iff `FORENSIC_TRACE=true` (case-insensitive, whitespace-trimmed).
 * Single opt-in gate for ALL on-disk forensic artefacts (pipeline.log,
 * and network dumps). Default-deny: absent, empty, `false`, or any
 * other value resolves to false so nothing is captured unless explicitly
 * requested. Decoupled from `LOG_LEVEL` (verbosity) and `CI` (OTP/Telegram).
 * See `coding-principle-guidlines.md` §4 (Default Deny).
 * @returns True only when the flag is the literal `true`.
 */
function isForensicTrace(): IsForensicTraceActive {
  return activeEnvironment().forensicTrace as IsForensicTraceActive;
}

/**
 * Per-run unique identifier — `DD-MM-YYYY_HHMMSScc` stamp allocated once per
 * run scope. Used as the `runId` field auto-injected on every log line via the
 * pino mixin in `BankContext.ts`, and as the leaf folder name when trace-mode
 * artefacts are written. Returns `''` outside a run scope, so pre-run log
 * lines simply omit the field.
 *
 * @returns The run-stamp string, or empty outside a run scope.
 */
export function getActiveRunId(): RunStampStr {
  const bank = resolveBankSlug();
  if (bank.length === 0) return '' as RunStampStr;
  const trace = traceOwner();
  if (trace === false) return '' as RunStampStr;
  if (trace.runId) return trace.runId as RunStampStr;
  trace.runId = nextRunStamp();
  return trace.runId as RunStampStr;
}

/** The root, bank and stamp one run folder is built from. */
interface IRunSeed {
  readonly root: string;
  readonly bank: BankSlugLower;
  readonly stamp: RunStampStr;
}

/**
 * Resolve the root, bank and stamp a run folder is named from. The caller
 * checks the FORENSIC_TRACE opt-in first; this only gathers the naming pieces.
 * @returns The seed pieces, or false when no bank or stamp is known.
 */
function runSeed(): IRunSeed | false {
  const bank = resolveBankSlug();
  if (bank.length === 0) return false;
  const stamp = getActiveRunId();
  if (stamp.length === 0) return false;
  return { root: activeEnvironment().runsRoot, bank, stamp };
}

/**
 * Create the run folder one execution's artefacts are written under.
 * @param seed - The root, bank and stamp the folder is named from.
 * @returns The folder's absolute path.
 */
function makeRunFolder(seed: IRunSeed): string {
  const root = ensurePrivateRunRoot(seed.root);
  const folder = path.join(root, PIPELINE_SEGMENT, seed.bank, seed.stamp);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  return folder;
}

/**
 * Lazily resolve the running execution's run folder
 * `<RUNS_ROOT>/pipeline/<bank>/<DDMMYY-HHMMSScc>/`. Path format is the same
 * for every log level. Returns `''` when forensic capture is disabled
 * (`FORENSIC_TRACE` not `true`) OR when the caller is outside every run scope —
 * letting module-init code (e.g. Debug.ts's pino transport setup at import
 * time) safely fall back to console-only before a run starts. The "no run
 * without bank" rule is enforced at pipeline start by `PipelineExecutor`
 * checking the company id before it opens the run scope.
 * Reuses {@link getActiveRunId}'s cached stamp so the on-disk folder
 * leaf and the in-log `runId` field always match. The opt-in flag is
 * re-checked on every call ahead of the cache, so clearing `FORENSIC_TRACE`
 * mid-process stops path emission instead of serving the cached folder.
 * @returns Absolute folder path, or empty string.
 */
function getRunFolder(): RunFolderPath {
  const trace = traceOwner();
  if (trace === false || !isForensicTrace() || trace.isClosed) return '' as RunFolderPath;
  if (trace.folder) return trace.folder as RunFolderPath;
  const seed = runSeed();
  if (seed === false) return '' as RunFolderPath;
  trace.folder = makeRunFolder(seed);
  return trace.folder as RunFolderPath;
}

/**
 * Pipeline-log destination inside the run folder. Empty string when off
 * trace or outside a run scope (so Pino transport falls back to
 * terminal-only before a run starts).
 * @returns Absolute log file path, or empty string off-trace.
 */
export function getLogFile(): LogFilePath {
  const root = getRunFolder();
  if (!root) return '' as LogFilePath;
  return path.join(root, PIPELINE_LOG_FILE) as LogFilePath;
}

/**
 * Mark the running execution's trace finished, so a late async callback cannot
 * allocate a new folder or reopen its log file. Outside an execution this does
 * nothing.
 * @returns True after closing.
 */
export function closeActiveRunTrace(): true {
  const scope = currentRunScope();
  if (scope) scope.trace.isClosed = true;
  return true;
}

export { isKnownBankSlug } from './BankSlugs.js';
