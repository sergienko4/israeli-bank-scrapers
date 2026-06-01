/**
 * Camoufox-aware process-environment snapshot for the INIT phase.
 * Emits ONE structured log line per scraper process so CI-vs-local
 * triage has a stable correlation surface.
 *
 * <p>Why this exists (PR #289 follow-up). Beinleumi CI failures
 * present as "page rendered, OTP detector finds nothing" but the
 * page renders fine locally (docker + Windows confirmed). The
 * first triage question is "is the environment different?" — and
 * with Camoufox there are TWO environments to compare:
 *
 * <ul>
 *   <li><b>Process side</b> (what the host actually has): Node
 *       version, platform, arch, locale, timezone, and the raw
 *       `CAMOUFOX_*` env-var knobs that fed the launcher.</li>
 *   <li><b>Page side</b> (what the bank actually sees after
 *       Camoufox spoofing): `navigator.userAgent`,
 *       `navigator.platform`, `navigator.languages`,
 *       `navigator.webdriver`, page `Intl` timezone + locale,
 *       and `screen` / `window.inner*` dimensions.</li>
 * </ul>
 *
 * The DELTA between process side and page side IS the diagnostic
 * value. Per https://camoufox.com/features/ Camoufox spoofs all
 * of those page-side fields at the C++ level, so seeing them
 * captured proves stealth is holding (e.g. `pageWebdriver: 'false'`
 * + `pagePlatform: 'Win32'` on a Linux runner = stealth working;
 * `pageWebdriver: 'true'` = stealth broken).
 *
 * <p>Stack reminder (`src/Common/CamoufoxLauncher.ts`): this fork
 * uses Camoufox (Firefox + C++-level anti-detect stealth) via
 * `@hieutran094/camoufox-js`, NOT Chromium. `browser.version()`
 * returns the underlying Firefox build string;
 * `browser.browserType().name()` returns `'firefox'`.
 *
 * <p>Env is CONSTANT per process — re-emitting per failure would
 * pollute logs. ONE `PIPELINE-ENV` log line per scraper invocation;
 * readers grep on the event name and diff against a known-good
 * baseline. Fires unconditionally on every process (CI + local +
 * docker). Per the "never throws" contract every sub-read is
 * wrapped — env-snapshot is observability-only and MUST NOT crash
 * the launch path.
 */

import type { Browser, Page } from 'playwright-core';

import type { ScraperLogger } from '../../Types/Debug.js';
import { isSome, none, type Option, some } from '../../Types/Option.js';
import { readInitForensicsGate } from './InitForensicsGate.js';

/**
 * Full process-environment snapshot emitted by {@link logEnvSnapshot}.
 * Field shapes are flat strings/numbers so the log payload stays
 * grep-friendly and diff-friendly across runs. ONLY contains
 * process-side fields — page-side fields were REMOVED in the
 * PR-#289 follow-up (the `page.evaluate()` they required ran on
 * `about:blank` BEFORE bank navigation, threw silently on Camoufox,
 * AND added a Marionette-wire activity dimension that Imperva's
 * risk model flagged → Hapoalim hCaptcha escalation regression).
 */
export interface IEnvSnapshot {
  readonly browserName: string;
  readonly browserVersion: string;
  readonly camoufoxHumanize: string;
  readonly camoufoxDisableCoop: string;
  readonly camoufoxBlockWebrtc: string;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly processTimezone: string;
  readonly processLocale: string;
  readonly nodeVersion: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly pid: number;
}

/**
 * Inputs to {@link logEnvSnapshot} — bundled to satisfy the project's
 * `max-params: 3` rule and to mirror the existing init-time helper
 * style in {@link "./NavigationDiagnostics.js"}.
 */
export interface ILogEnvInput {
  readonly browser: Browser;
  readonly page: Page;
  readonly logger: ScraperLogger;
}

/** Sentinel used when the runtime cannot supply a real value. */
const UNKNOWN_ENV_VALUE = 'unknown';
/** Sentinel for an unset Camoufox env-var knob. */
const UNSET_ENV_VALUE = '<unset>';
/** Default viewport / page-dimension sentinel when unavailable. */
const NO_DIMENSION = 0;
/** Camoufox env-var names captured in the snapshot. */
const CAMOUFOX_HUMANIZE_VAR = 'CAMOUFOX_HUMANIZE';
const CAMOUFOX_DISABLE_COOP_VAR = 'CAMOUFOX_DISABLE_COOP';
const CAMOUFOX_BLOCK_WEBRTC_VAR = 'CAMOUFOX_BLOCK_WEBRTC';

/**
 * Read the underlying Firefox build version from the live Camoufox
 * browser. `browser.version()` returns a string synchronously in
 * Playwright; wrapped in try/catch so a Playwright surface change
 * cannot crash the launch path.
 *
 * @param browser - Live Camoufox browser handle.
 * @returns Firefox build version or sentinel on failure.
 */
function readBrowserVersion(browser: Browser): string {
  try {
    return browser.version();
  } catch {
    return UNKNOWN_ENV_VALUE;
  }
}

/**
 * Read the engine name Playwright reports for this browser. For the
 * Camoufox stack this is always `'firefox'`; we surface it so a
 * future engine-swap regression (e.g. accidental Chromium fallback)
 * is visible in a single grep over the `PIPELINE-ENV` event.
 *
 * @param browser - Live Camoufox browser handle.
 * @returns Engine name or sentinel on failure.
 */
function readBrowserName(browser: Browser): string {
  try {
    return browser.browserType().name();
  } catch {
    return UNKNOWN_ENV_VALUE;
  }
}

/**
 * Safe wrapper around `page.viewportSize()` — returns `Option<T>`
 * representing both the "no viewport configured" and the "call
 * threw" cases. Extracted to keep {@link readViewport} within
 * `max-depth: 1` and to honour the "no null returns" architecture rule.
 *
 * @param page - Playwright page.
 * @returns `some(size)` when present, `none()` otherwise.
 */
function readViewportOption(page: Page): Option<IViewportSize> {
  try {
    const size = page.viewportSize();
    return size === null ? none() : some(size);
  } catch {
    return none();
  }
}

/**
 * Read the Playwright viewport (the configured render size, NOT
 * what `window.innerWidth` reports). Returns sentinels when no
 * viewport is set on the context.
 *
 * @param page - Playwright page.
 * @returns Width/height tuple, with sentinels when unknown.
 */
function readViewport(page: Page): IViewportSize {
  const opt = readViewportOption(page);
  if (isSome(opt)) return opt.value;
  return { width: NO_DIMENSION, height: NO_DIMENSION };
}

/**
 * Read the Node-process locale + timezone from the V8 Intl API.
 * These are the host values BEFORE Camoufox spoofing; compare
 * against `pageTimezone` / `pageLocale` to confirm spoofing is
 * applied (CI host UTC → page spoofed Asia/Jerusalem, etc.).
 *
 * @returns Process locale + timezone strings.
 */
function readProcessIntl(): IProcessIntlBundle {
  const opts = Intl.DateTimeFormat().resolvedOptions();
  return { processLocale: opts.locale, processTimezone: opts.timeZone };
}

/**
 * Read one Camoufox env-var knob, reporting `<unset>` when missing
 * so the log line always has the same shape. We report the RAW env
 * value (pre-parse) rather than the parsed boolean because that is
 * what a human compares against the deploy spec.
 *
 * @param name - Env-var name.
 * @returns Raw env value or unset sentinel.
 */
function readEnvFlag(name: string): string {
  return process.env[name] ?? UNSET_ENV_VALUE;
}

/**
 * Read all three Camoufox anti-detect knobs in one go. Pulled into
 * its own helper so {@link captureEnvSnapshot} stays ≤10 LoC.
 *
 * @returns Bundle of the three knob values, shaped for snapshot keys.
 */
function readCamoufoxKnobs(): ICamoufoxKnobsBundle {
  return {
    camoufoxHumanize: readEnvFlag(CAMOUFOX_HUMANIZE_VAR),
    camoufoxDisableCoop: readEnvFlag(CAMOUFOX_DISABLE_COOP_VAR),
    camoufoxBlockWebrtc: readEnvFlag(CAMOUFOX_BLOCK_WEBRTC_VAR),
  };
}

/**
 * Read the immutable Node-process fields (version, platform, arch,
 * pid). Pulled into its own helper so {@link assembleEnvSnapshot}
 * stays ≤10 LoC.
 *
 * @returns Node-process identification bundle.
 */
function readProcessIdent(): IProcessIdentBundle {
  return {
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
  };
}

/** Bundle passed to {@link assembleEnvSnapshot} (`max-params: 3`). */
interface IEnvSnapshotParts {
  readonly browserName: string;
  readonly browserVersion: string;
  readonly viewport: IViewportSize;
}

/** Internal bundle returned by {@link readProcessIntl}. */
interface IProcessIntlBundle {
  readonly processLocale: string;
  readonly processTimezone: string;
}

/** Internal bundle returned by {@link readProcessIdent}. */
interface IProcessIdentBundle {
  readonly nodeVersion: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly pid: number;
}

/** Internal bundle returned by {@link readCamoufoxKnobs}. */
interface ICamoufoxKnobsBundle {
  readonly camoufoxHumanize: string;
  readonly camoufoxDisableCoop: string;
  readonly camoufoxBlockWebrtc: string;
}

/** Internal bundle returned by {@link readViewport}. */
interface IViewportBundle {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

/**
 * Combine the captured live-browser readings with the static
 * process-level fields into the final {@link IEnvSnapshot} shape.
 * Pulled out so {@link captureEnvSnapshot} stays ≤10 LoC.
 *
 * @param parts - Live-browser sub-readings.
 * @returns The assembled snapshot.
 */
/** Width/height tuple returned by {@link readViewport}. */
interface IViewportSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Project the typed viewport tuple into the snapshot-shaped
 * `viewportWidth` / `viewportHeight` keys. Pulled out so
 * {@link assembleEnvSnapshot} stays ≤10 LoC.
 *
 * @param viewport - Width/height tuple from {@link readViewport}.
 * @returns Snapshot-key-shaped viewport bundle.
 */
function buildViewportBundle(viewport: IViewportSize): IViewportBundle {
  return { viewportWidth: viewport.width, viewportHeight: viewport.height };
}

/**
 * Combine the captured live-browser readings with the static
 * process-level fields into the final {@link IEnvSnapshot} shape.
 * Pulled out so {@link captureEnvSnapshot} stays ≤10 LoC.
 *
 * @param parts - Live-browser sub-readings.
 * @returns The assembled snapshot.
 */
function assembleEnvSnapshot(parts: IEnvSnapshotParts): IEnvSnapshot {
  const { browserName, browserVersion, viewport } = parts;
  const view = buildViewportBundle(viewport);
  const knobs = readCamoufoxKnobs();
  const intl = readProcessIntl();
  const ident = readProcessIdent();
  return { browserName, browserVersion, ...knobs, ...view, ...intl, ...ident };
}

/**
 * Capture the process-environment snapshot used by
 * {@link logEnvSnapshot}. Each sub-read is wrapped to honour the
 * "never throws" contract — env-snapshot is observability-only and
 * MUST NOT crash the launch path even when a sub-read fails. Only
 * reads PROCESS-side state (browser metadata + viewport size +
 * env-var knobs + Node host info) — page-context state is NOT
 * captured because the prior `page.evaluate()` implementation
 * perturbed Camoufox's Marionette fingerprint and tripped Imperva
 * hCaptcha (PR #289 → Hapoalim Real B regression). For page-side
 * forensics use the L7 observers in {@link "./PageObservers.js"}
 * gated by {@link "./InitForensicsGate.js"}.
 *
 * @param input - Browser + page + logger bundle.
 * @returns Snapshot ready for the PIPELINE-ENV log line.
 */
function captureEnvSnapshot(input: ILogEnvInput): IEnvSnapshot {
  const browserName = readBrowserName(input.browser);
  const browserVersion = readBrowserVersion(input.browser);
  const viewport = readViewport(input.page);
  return assembleEnvSnapshot({ browserName, browserVersion, viewport });
}

/**
 * Build the fallback snapshot returned when {@link captureEnvSnapshot}
 * throws unexpectedly — preserves the never-throws contract while
 * still emitting a PIPELINE-ENV log line that signals "snapshot
 * unavailable" rather than silently dropping the event.
 *
 * @returns Sentinel snapshot with all fields set to UNKNOWN.
 */
function buildFallbackEnvSnapshot(): IEnvSnapshot {
  return assembleEnvSnapshot({
    browserName: UNKNOWN_ENV_VALUE,
    browserVersion: UNKNOWN_ENV_VALUE,
    viewport: { width: NO_DIMENSION, height: NO_DIMENSION },
  });
}

/**
 * Safely capture the env snapshot — wraps {@link captureEnvSnapshot}
 * to honour the never-throws contract even when an unexpected
 * sub-read failure escapes the inner try/catch blocks.
 *
 * @param input - Browser + page + logger bundle.
 * @returns The snapshot, or a fallback snapshot on failure.
 */
function safeCaptureEnvSnapshot(input: ILogEnvInput): IEnvSnapshot {
  try {
    return captureEnvSnapshot(input);
  } catch {
    return buildFallbackEnvSnapshot();
  }
}

/**
 * Emit the PIPELINE-ENV log line inside an inline try/catch — the
 * logger may throw in tests using non-Pino fakes. We always continue
 * after attempting to emit, preserving the never-throws contract on
 * the host {@link logEnvSnapshot}.
 *
 * @param logger - Pipeline logger to receive the event.
 * @param snapshot - Snapshot to emit.
 * @returns `true` on success, `false` when the logger threw.
 */
function tryEmitEnvSnapshot(logger: ScraperLogger, snapshot: IEnvSnapshot): boolean {
  try {
    logger.info({ event: 'PIPELINE-ENV', ...snapshot });
    return true;
  } catch {
    return false;
  }
}

/**
 * Capture and emit the PIPELINE-ENV log line. Single call site —
 * `executeLaunchBrowser` invokes this once per process after
 * post-launch setup completes. Returns the snapshot for caller
 * chaining (echo pattern); the snapshot is also embedded in the
 * emitted log payload so a single grep on `event:"PIPELINE-ENV"`
 * surfaces everything. ALWAYS resolves; never throws. Gated by
 * {@link readInitForensicsGate}: when forensics are OFF the
 * function emits NOTHING and returns the fallback snapshot — this
 * keeps the launch path byte-identical to the WAF-passing
 * pre-PR-289 baseline.
 *
 * @param input - Browser + page + logger bundle.
 * @returns The snapshot that was emitted (for caller chaining).
 */
export function logEnvSnapshot(input: ILogEnvInput): Promise<IEnvSnapshot> {
  const gate = readInitForensicsGate();
  if (!gate.enabled) {
    const fallback = buildFallbackEnvSnapshot();
    return Promise.resolve(fallback);
  }
  const snapshot = safeCaptureEnvSnapshot(input);
  tryEmitEnvSnapshot(input.logger, snapshot);
  return Promise.resolve(snapshot);
}

export { NO_DIMENSION, UNKNOWN_ENV_VALUE, UNSET_ENV_VALUE };
