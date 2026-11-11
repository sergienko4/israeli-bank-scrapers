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
 * `<bank>` is auto-detected from the test pattern in process.argv (e.g.
 * `Beinleumi.e2e-real.test.ts` → `beinleumi`); also accepts an explicit
 * registration via `setActiveBank(slug)` from the pipeline orchestrator.
 * Throws when no bank can be resolved — there is no run without a bank.
 * `cc` is centiseconds (1/100 s) for sub-second uniqueness across parallel
 * jest invocations.
 *
 * Capture is gated centrally by `FORENSIC_TRACE` (see {@link isForensicTrace}):
 * when the flag is off (default) every artefact getter returns `''` and the
 * writer layer (Pino transport and HTTP capture hooks) no-ops.
 * `LOG_LEVEL` independently controls log verbosity only — it
 * no longer decides whether artefacts land on disk.
 *
 * Override with `RUNS_ROOT` env var when the default `C:\tmp\runs` is wrong
 * (e.g. CI). Folder paths and `runId` are cached within one bank run and
 * reset automatically when `setActiveBank` switches to a different bank slug.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Brand } from './Brand.js';
import type { RunStampStr } from './TraceStamp.js';
import { nextRunStamp, resetRunStampState } from './TraceStamp.js';

/** Lowercase bank slug (or empty). */
type BankSlugLower = Brand<string, 'BankSlugLower'>;
/** setActiveBank acceptance outcome. */
type DidAcceptBank = Brand<boolean, 'DidAcceptBank'>;
/** Forensic-trace active flag. */
type IsForensicTraceActive = Brand<boolean, 'IsForensicTraceActive'>;
/** Absolute run folder path (or empty when off-trace). */
type RunFolderPath = Brand<string, 'RunFolderPath'>;
/** Absolute log file path (or empty). */
type LogFilePath = Brand<string, 'LogFilePath'>;
/** Absolute network-dump directory (or empty). */
type NetworkDumpDirPath = Brand<string, 'NetworkDumpDirPath'>;

/** Default root for per-run artefact folders — overridable via RUNS_ROOT. */
const DEFAULT_RUNS_ROOT = String.raw`C:\tmp\runs`;
/** Sub-directory for network response body dumps. */
const NETWORK_SUBDIR = 'network';
/** Filename for the pipeline log inside the run folder. */
const PIPELINE_LOG_FILE = 'pipeline.log';
/** Top-level umbrella segment under RUNS_ROOT — fixed for every pipeline run. */
const PIPELINE_SEGMENT = 'pipeline';

/** Cached run folder for the active bank (created on first call to getRunFolder). */
let runFolderCache: string | false = false;
/** Cached network dump dir (created on first call to getNetworkDumpDir). */
let networkDirCache: string | false = false;
/** Cached per-substep dump dirs keyed by `<phase>-<stage>`. */
const SUB_STEP_DIR_CACHE = new Map<string, string>();
/** Active bank for this process — set dynamically by the pipeline orchestrator. */
let activeBankCache: string | false = false;
/**
 * Per-bank-run unique identifier — the same `DD-MM-YYYY_HHMMSScc` stamp that
 * names the run-artefact folder on disk. Cached on first read for the active
 * bank and cleared when {@link setActiveBank} switches banks, so sequential
 * scrapes of different banks never share a `runId` or trace folder.
 */
let activeRunIdCache: string | false = false;

/** Bank slugs the auto-detector recognises in test argv. Lowercase, single token. */
const KNOWN_BANK_SLUGS: readonly string[] = [
  'amex',
  'beinleumi',
  'discount',
  'hapoalim',
  'isracard',
  'leumi',
  'max',
  'massad',
  'mercantile',
  'mizrahi',
  'onezero',
  'otsarhahayal',
  'pagi',
  'paybox',
  'pepper',
  'visacal',
  'yahav',
];

/**
 * Build the regex that matches a bank slug in the canonical test-file name
 * `<Bank>.e2e-real.test.ts`. Extracted to flatten detectBankFromArgv (the
 * codebase forbids nesting `RegExp` inside the loop).
 * @param slug - Lowercase bank slug.
 * @returns Anchored regex for that slug.
 */
function bankSlugRegex(slug: string): RegExp {
  // Slug must be preceded by start-of-string or any non-word char (`\W`)
  // so substrings like `--maxWorkers=2` don't trigger a false match for
  // the `max` slug (the `s` after `max` is a word char), but a real path
  // (`/Tests/E2eReal/isracard.e2e-real.test.ts`) and a jest-flag form
  // (`--testPathPatterns=Isracard\.e2e-real\.test\.ts$`) do match. Each
  // dot is `\\?\.` so we accept BOTH literal and regex-escaped forms.
  return new RegExp(String.raw`(^|\W)${slug}\\?\.e2e-real\\?\.test\\?\.ts`);
}

/**
 * Detect the active bank slug from `process.argv` by matching the canonical
 * test-file pattern `<Bank>.e2e-real.test.ts`. Returns the lowercase slug
 * when matched, else `''` so the caller can decide how to handle it.
 * @returns Lowercase bank slug, or empty string when no match.
 */
export function detectBankFromArgv(): BankSlugLower {
  const haystack = process.argv.join(' ').toLowerCase();
  const match = KNOWN_BANK_SLUGS.find((slug): boolean => bankSlugRegex(slug).test(haystack));
  return (match ?? '') as BankSlugLower;
}

/**
 * Clear per-run folder, network-dump, sub-step, and runId caches when the
 * active bank changes or during explicit test resets.
 * @returns True after clearing.
 */
function clearRunCaches(): true {
  runFolderCache = false;
  networkDirCache = false;
  SUB_STEP_DIR_CACHE.clear();
  activeRunIdCache = false;
  return true;
}

/**
 * Register the active bank for this process. Called by the pipeline runner
 * at startup so `resolveBankSlug()` returns the active slug regardless of how
 * Jest/the test orchestrator was invoked. Idempotent for repeated calls with
 * the same bank; clears run caches when switching to a different bank slug.
 * @param slug - Lowercase bank slug (must be in KNOWN_BANK_SLUGS).
 * @returns True when accepted, false when the slug is unknown.
 */
export function setActiveBank(slug: string): DidAcceptBank {
  const normalised = slug.trim().toLowerCase();
  if (!normalised || !KNOWN_BANK_SLUGS.includes(normalised)) return false as DidAcceptBank;
  if (resolveBankSlug() !== normalised) clearRunCaches();
  activeBankCache = normalised;
  return true as DidAcceptBank;
}

/**
 * Resolve the bank slug for this process. Tries the dynamically-registered
 * slug first (via `setActiveBank`), then falls through to argv detection.
 * Returns `''` when neither yields a known slug; the caller decides how to
 * handle the missing slug (see `getRunFolder` for the trace-mode behaviour).
 * @returns Bank slug, or empty string when not yet known.
 */
function resolveBankSlug(): BankSlugLower {
  if (activeBankCache) return activeBankCache as BankSlugLower;
  return detectBankFromArgv();
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
export function isForensicTrace(): IsForensicTraceActive {
  const v = (process.env.FORENSIC_TRACE ?? '').trim().toLowerCase();
  return (v === 'true') as IsForensicTraceActive;
}

/**
 * Per-bank-run unique identifier — `DD-MM-YYYY_HHMMSScc` stamp cached for the
 * active bank and reset when {@link setActiveBank} switches banks. Used as
 * the `runId` field auto-injected on every log line via the pino mixin in
 * `BankContext.ts`, and as the leaf folder name when trace-mode artefacts are
 * written. Returns `''` only when no bank slug has been resolved yet —
 * pre-`setActiveBank` log lines simply omit the field.
 *
 * @returns The run-stamp string, or empty when bank is not yet known.
 */
export function getActiveRunId(): RunStampStr {
  if (activeRunIdCache) return activeRunIdCache as RunStampStr;
  const bank = resolveBankSlug();
  if (bank.length === 0) return '' as RunStampStr;
  activeRunIdCache = nextRunStamp();
  return activeRunIdCache as RunStampStr;
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
  const root = process.env.RUNS_ROOT ?? DEFAULT_RUNS_ROOT;
  return { root, bank, stamp };
}

/**
 * Lazily resolve the per-process run folder
 * `<RUNS_ROOT>/pipeline/<bank>/<DDMMYY-HHMMSScc>/`. Path format is the same
 * for every log level. Returns `''` when forensic capture is disabled
 * (`FORENSIC_TRACE` not `true`) OR when no bank has been registered yet —
 * letting module-init code (e.g. Debug.ts's pino transport setup at import
 * time) safely fall back to console-only without forcing a bank registration
 * before imports resolve. The "no run without
 * bank" rule is enforced at pipeline start by `PipelineExecutor` calling
 * `setActiveBank(companyId)` and failing if the slug isn't recognised.
 * Reuses {@link getActiveRunId}'s cached stamp so the on-disk folder
 * leaf and the in-log `runId` field always match. The opt-in flag is
 * re-checked on every call ahead of the cache, so clearing `FORENSIC_TRACE`
 * mid-process stops path emission instead of serving the cached folder.
 * @returns Absolute folder path, or empty string.
 */
export function getRunFolder(): RunFolderPath {
  if (!isForensicTrace()) return '' as RunFolderPath;
  if (runFolderCache) return runFolderCache as RunFolderPath;
  const seed = runSeed();
  if (seed === false) return '' as RunFolderPath;
  const folder = path.join(seed.root, PIPELINE_SEGMENT, seed.bank, seed.stamp);
  fs.mkdirSync(folder, { recursive: true });
  runFolderCache = folder;
  return folder as RunFolderPath;
}

/**
 * Pipeline-log destination inside the run folder. Empty string when off
 * trace (so Pino transport falls back to terminal-only without a bank
 * needing to register).
 * @returns Absolute log file path, or empty string off-trace.
 */
export function getLogFile(): LogFilePath {
  const root = getRunFolder();
  if (!root) return '' as LogFilePath;
  return path.join(root, PIPELINE_LOG_FILE) as LogFilePath;
}

/**
 * Network-dump directory inside the run folder. Empty string off-trace so
 * HTTP capture hooks skip body dumps without forcing a bank registration.
 * @returns Absolute network-dump directory path, or empty string off-trace.
 */
export function getNetworkDumpDir(): NetworkDumpDirPath {
  const root = getRunFolder();
  if (!root) return '' as NetworkDumpDirPath;
  if (networkDirCache) return networkDirCache as NetworkDumpDirPath;
  const dir = path.join(root, NETWORK_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  networkDirCache = dir;
  return dir as NetworkDumpDirPath;
}

/**
 * Create the per-substep dump folder inside the active network-dump root.
 * @param root - Active network-dump directory path.
 * @param key - `<phase>-<stage>` folder name.
 * @returns The created sub-step folder path.
 */
function makeSubStepDir(root: NetworkDumpDirPath, key: string): NetworkDumpDirPath {
  const dir = path.join(root, key);
  fs.mkdirSync(dir, { recursive: true });
  return dir as NetworkDumpDirPath;
}

/**
 * Per-substep network dump dir
 * `<run>/network/<phase>-<stage>/`. Each sub-step gets its own
 * folder so the on-disk layout itself answers "which sub-step saw
 * this capture" without timestamp cross-referencing. Empty string off-trace.
 * @param phase - Active phase name from ActiveState.
 * @param stage - Active stage label from ActiveState.
 * @returns Absolute sub-step folder path, or empty string off-trace.
 */
export function getSubStepNetworkDumpDir(phase: string, stage: string): NetworkDumpDirPath {
  const root = getNetworkDumpDir();
  if (!root) return '' as NetworkDumpDirPath;
  const key = `${phase}-${stage}`;
  const cached = SUB_STEP_DIR_CACHE.get(key);
  if (cached !== undefined) return cached as NetworkDumpDirPath;
  const dir = makeSubStepDir(root, key);
  SUB_STEP_DIR_CACHE.set(key, dir);
  return dir;
}

/**
 * Reset cached folders. Test-only — production callers should never need
 * this. Used by Jest's jest.resetModules path; exported so unit tests can
 * exercise different env-var combinations cleanly.
 * @returns True after reset.
 */
export function resetTraceConfigCache(): true {
  clearRunCaches();
  activeBankCache = false;
  resetRunStampState();
  return true;
}

export { formatRunStamp } from './TraceStamp.js';
