/**
 * Trace-mode artefact root — single per-process folder for the pipeline log,
 * network response dumps, and screenshots when `LOG_LEVEL=trace`. Removes
 * the older patchwork of independent env vars (LOG_FILE / LOG_PATH /
 * LOG_BANK / DUMP_NETWORK_DIR / DUMP_NETWORK_LABEL) that had to be wired up
 * by hand on every run.
 *
 * Layout (created lazily on first use):
 *   <RUNS_ROOT>/pipeline/<bank>/<DDMMYY-HHMMSScc>/
 *     pipeline.log
 *     network/<NNNN>-<METHOD>-<safe-url>.json
 *     screenshots/<bank>-<label>-<HHMMSS>.png
 *
 * `<bank>` is auto-detected from the test pattern in process.argv (e.g.
 * `Beinleumi.e2e-real.test.ts` → `beinleumi`); also accepts an explicit
 * registration via `setActiveBank(slug)` from the pipeline orchestrator.
 * Throws when no bank can be resolved — there is no run without a bank.
 * `cc` is centiseconds (1/100 s) for sub-second uniqueness across parallel
 * jest invocations.
 *
 * Path layout is independent of LOG_LEVEL — any log level resolves to the
 * same `<RUNS_ROOT>/pipeline/<bank>/<stamp>/` root. The decision of which
 * artefacts to actually write at a given log level happens in the writer
 * layer (Pino transport, NetworkDiscovery dump gate, screenshot helpers),
 * not here.
 *
 * Override with `RUNS_ROOT` env var when the default `C:\tmp\runs` is wrong
 * (e.g. CI). Folder paths are cached after first creation, so all artefacts
 * within a single process share the same root.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Two-character zero-padded numeric string, e.g. "07". */
type PaddedDigits = string;
/** `DDMMYY-HHMMSScc` timestamp string. */
type RunStamp = string;
/** Lowercase bank slug, or empty string when not detected. */
type BankSlug = string;
/** Whether `LOG_LEVEL=trace` is active. */
type IsTraceMode = boolean;
/** Absolute artefact path or empty string when off-trace. */
type ArtefactPath = string;
/** Whether a candidate slug matches the active test pattern. */
type IsBankSlugMatch = boolean;

/** Default root for per-run artefact folders — overridable via RUNS_ROOT. */
const DEFAULT_RUNS_ROOT = String.raw`C:\tmp\runs`;
/** Sub-directory for network response body dumps. */
const NETWORK_SUBDIR = 'network';
/** Sub-directory for OTP / phase diagnostic screenshots. */
const SCREENSHOT_SUBDIR = 'screenshots';
/** Filename for the pipeline log inside the run folder. */
const PIPELINE_LOG_FILE = 'pipeline.log';
/** Top-level umbrella segment under RUNS_ROOT — fixed for every pipeline run. */
const PIPELINE_SEGMENT = 'pipeline';

/** Cached per-process run folder (created on first call to getRunFolder). */
let runFolderCache: string | false = false;
/** Cached network dump dir (created on first call to getNetworkDumpDir). */
let networkDirCache: string | false = false;
/** Cached screenshot dir (created on first call to getScreenshotDir). */
let screenshotDirCache: string | false = false;
/** Active bank for this process — set dynamically by the pipeline orchestrator. */
let activeBankCache: BankSlug | false = false;

/**
 * Pad a 1- or 2-digit positive integer to width 2 with leading zero.
 * @param n - Integer to pad.
 * @returns Two-character string.
 */
function pad2(n: number): PaddedDigits {
  const s = String(n);
  return s.padStart(2, '0');
}

/**
 * Build a `DD-MM-YYYY_HHMMSScc` timestamp for the given Date instance. `cc` is
 * centiseconds (milliseconds / 10), zero-padded to two digits — gives
 * sub-second uniqueness without forcing a separate millisecond field.
 * @param d - Date to format.
 * @returns Timestamp string.
 */
function formatRunStamp(d: Date): RunStamp {
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const year = d.getFullYear() % 10000;
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = d.getSeconds();
  const centiseconds = Math.floor(d.getMilliseconds() / 10);
  const dd = pad2(day);
  const mm = pad2(month);
  const yyyy = pad2(year);
  const hh = pad2(hours);
  const mi = pad2(minutes);
  const ss = pad2(seconds);
  const cc = pad2(centiseconds);
  return `${dd}-${mm}-${yyyy}_${hh}${mi}${ss}${cc}`;
}

/** Bank slugs the auto-detector recognises in test argv. Lowercase, single token. */
const KNOWN_BANK_SLUGS: readonly string[] = [
  'amex',
  'beinleumi',
  'discount',
  'hapoalim',
  'isracard',
  'max',
  'massad',
  'mercantile',
  'onezero',
  'otsarhahayal',
  'pagi',
  'pepper',
  'visacal',
];

/**
 * Detect the active bank slug from `process.argv` by matching the canonical
 * test-file pattern `<Bank>.e2e-real.test.ts`. Returns the lowercase slug
 * when matched, else `''` so the caller can fall back to a default.
 * @returns Lowercase bank slug, or empty string when no match.
 */
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
function detectBankFromArgv(): BankSlug {
  const argvJoined = process.argv.join(' ');
  const haystack = argvJoined.toLowerCase();
  const match = KNOWN_BANK_SLUGS.find(
    (slug): IsBankSlugMatch => bankSlugRegex(slug).test(haystack),
  );
  return match ?? '';
}

/**
 * Register the active bank for this process. Called by the pipeline runner
 * at startup so `resolveBankSlug()` can return the correct slug regardless
 * of how Jest/the test orchestrator was invoked. Idempotent — last writer
 * wins (cheap to call from multiple call sites).
 * @param slug - Lowercase bank slug (must be in KNOWN_BANK_SLUGS).
 * @returns True when accepted, false when the slug is unknown.
 */
function setActiveBank(slug: string): IsBankSlugMatch {
  const normalised = slug.trim().toLowerCase();
  if (normalised.length === 0) return false;
  const isKnown = KNOWN_BANK_SLUGS.includes(normalised);
  if (!isKnown) return false;
  activeBankCache = normalised;
  return true;
}

/**
 * Resolve the bank slug for this process. Tries the dynamically-registered
 * slug first (via `setActiveBank`), then falls through to argv detection.
 * Returns `''` when neither yields a known slug; the caller decides how to
 * handle the missing slug (see `getRunFolder` for the trace-mode behaviour).
 * @returns Bank slug, or empty string when not yet known.
 */
function resolveBankSlug(): BankSlug {
  if (activeBankCache) return activeBankCache;
  const fromArgv = detectBankFromArgv();
  if (fromArgv.length > 0) return fromArgv;
  return '';
}

/**
 * True iff `LOG_LEVEL=trace` (case-insensitive). Single source of truth for
 * "are we in trace mode" — used by every artefact subsystem to decide
 * whether to emit anything.
 * @returns True when trace mode is active.
 */
function isTraceMode(): IsTraceMode {
  const v = (process.env.LOG_LEVEL ?? '').toLowerCase();
  return v === 'trace';
}

/**
 * Lazily resolve the per-process run folder
 * `<RUNS_ROOT>/pipeline/<bank>/<DDMMYY-HHMMSScc>/`. Path format is the same
 * for every log level. Returns `''` when off-trace OR when no bank has
 * been registered yet — letting module-init code (e.g. Debug.ts's pino
 * transport setup at import time) safely fall back to console-only without
 * forcing a bank registration before imports resolve. The "no run without
 * bank" rule is enforced at pipeline start by `PipelineExecutor` calling
 * `setActiveBank(companyId)` and failing if the slug isn't recognised.
 * @returns Absolute folder path, or empty string.
 */
function getRunFolder(): ArtefactPath {
  if (!isTraceMode()) return '';
  if (runFolderCache) return runFolderCache;
  const bank = resolveBankSlug();
  if (bank.length === 0) return '';
  const root = process.env.RUNS_ROOT ?? DEFAULT_RUNS_ROOT;
  const stamp = formatRunStamp(new Date());
  const folder = path.join(root, PIPELINE_SEGMENT, bank, stamp);
  fs.mkdirSync(folder, { recursive: true });
  runFolderCache = folder;
  return folder;
}

/**
 * Pipeline-log destination inside the run folder. Empty string when off
 * trace (so Pino transport falls back to terminal-only without a bank
 * needing to register).
 * @returns Absolute log file path, or empty string off-trace.
 */
function getLogFile(): ArtefactPath {
  const root = getRunFolder();
  if (!root) return '';
  return path.join(root, PIPELINE_LOG_FILE);
}

/**
 * Network-dump directory inside the run folder. Empty string off-trace so
 * NetworkDiscovery skips body dumps without forcing a bank registration.
 * @returns Absolute network-dump directory path, or empty string off-trace.
 */
function getNetworkDumpDir(): ArtefactPath {
  if (networkDirCache) return networkDirCache;
  const root = getRunFolder();
  if (!root) return '';
  const dir = path.join(root, NETWORK_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  networkDirCache = dir;
  return dir;
}

/**
 * Screenshot directory inside the run folder. Empty string off-trace so
 * callers can skip the screenshot without needing a registered bank.
 * @returns Absolute screenshot directory path, or empty string off-trace.
 */
function getScreenshotDir(): ArtefactPath {
  if (screenshotDirCache) return screenshotDirCache;
  const root = getRunFolder();
  if (!root) return '';
  const dir = path.join(root, SCREENSHOT_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  screenshotDirCache = dir;
  return dir;
}

/**
 * Reset cached folders. Test-only — production callers should never need
 * this. Used by Jest's jest.resetModules path; exported so unit tests can
 * exercise different env-var combinations cleanly.
 * @returns True after reset.
 */
function resetTraceConfigCache(): true {
  runFolderCache = false;
  networkDirCache = false;
  screenshotDirCache = false;
  activeBankCache = false;
  return true;
}

export {
  detectBankFromArgv,
  formatRunStamp,
  getLogFile,
  getNetworkDumpDir,
  getRunFolder,
  getScreenshotDir,
  isTraceMode,
  resetTraceConfigCache,
  setActiveBank,
};
