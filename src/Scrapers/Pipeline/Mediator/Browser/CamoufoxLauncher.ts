import type { LaunchOptions as CamoufoxLaunchOptions } from '@hieutran094/camoufox-js';
import type { Browser } from 'playwright-core';

import {
  DESKTOP_VIEWPORT_HEIGHT,
  DESKTOP_VIEWPORT_WIDTH,
  ISRAEL_LOCALE,
} from '../../../../Common/Config/BrowserConfig.js';
import type { Brand } from '../../Types/Brand.js';
import { timeoutPromise } from '../Timing/TimingActions.js';

export { ISRAEL_LOCALE } from '../../../../Common/Config/BrowserConfig.js';

/**
 * Branded boolean produced by {@link envFlag}. Satisfies Pipeline
 * Rule #15 (no primitive returns from exported helpers) while
 * remaining assignable to any plain `boolean` consumer (Camoufox
 * launch-option fields such as `humanize`).
 */
export type EnvFlag = Brand<boolean, 'EnvFlag'>;

/** Truthy values for boolean env-var parsing in bisect experiments. */
const TRUTHY_ENV_VALUES: ReadonlySet<string> = new Set(['true', '1', 'yes', 'on']);

/**
 * Parse a boolean env var with a documented default. Used so CI can
 * flip individual Camoufox anti-detect knobs without a code edit
 * during bisect experiments. Production defaults stay `true` for
 * the documented Cloudflare-managed-challenge auto-pass recipe.
 * @param name - Env var name.
 * @param fallback - Default when the env var is unset.
 * @returns Parsed boolean wrapped in the nominal `EnvFlag` brand.
 */
export function envFlag(name: string, fallback: boolean): EnvFlag {
  const raw = process.env[name];
  if (raw === undefined) return fallback as EnvFlag;
  const normalised = raw.toLowerCase();
  return TRUTHY_ENV_VALUES.has(normalised) as EnvFlag;
}

/**
 * Pinned screen-dimension constraint applied to every Camoufox launch.
 * Setting min equal to max forces the exact desktop dimensions every
 * run so banks cannot serve mobile content via screen-size heuristics.
 */
const PINNED_SCREEN_CONSTRAINT = Object.freeze({
  minWidth: DESKTOP_VIEWPORT_WIDTH,
  maxWidth: DESKTOP_VIEWPORT_WIDTH,
  minHeight: DESKTOP_VIEWPORT_HEIGHT,
  maxHeight: DESKTOP_VIEWPORT_HEIGHT,
});

/**
 * Readonly table of Camoufox anti-detect knobs + their CI bisect-override
 * env-var names + production defaults. Centralised so {@link buildLaunchOptions}
 * stays a thin assembler and a single edit here flips every related callsite +
 * the {@link "../../../../Tests/Unit/Common/CamoufoxLauncherKnobs.test.ts"}
 * drift canary in lock-step (CR PR #286 F2 — readonly config table).
 *
 * Production defaults stay `true` for the documented Cloudflare-managed-
 * challenge auto-pass recipe (https://camoufox.com/python/usage/) — proven on
 * Amex Cloudflare + Hapoalim Incapsula in the cycle-3 forensic run.
 *
 * `block_webrtc` closes the WebRTC STUN IP-leak path that bot scorecards flag
 * as a high-confidence headless-Chromium / Selenium signal.
 */
const CAMOUFOX_KNOBS = Object.freeze({
  humanize: { envVar: 'CAMOUFOX_HUMANIZE', default: true },
  disable_coop: { envVar: 'CAMOUFOX_DISABLE_COOP', default: true },
  block_webrtc: { envVar: 'CAMOUFOX_BLOCK_WEBRTC', default: true },
} as const);

/** Valid Camoufox OS-fingerprint values (camoufox-js `os` option). */
const VALID_CAMOUFOX_OS = Object.freeze(['windows', 'macos', 'linux'] as const);

/** Union of the valid Camoufox OS-fingerprint values. */
type CamoufoxOs = (typeof VALID_CAMOUFOX_OS)[number];

/**
 * Production-default OS fingerprint. All banks are proven green on a
 * Windows fingerprint, so Windows stays the default; a CI bisect run
 * overrides it per-job via {@link CAMOUFOX_OS_ENV} without touching it.
 */
const DEFAULT_CAMOUFOX_OS: CamoufoxOs = 'windows';

/** CI bisect override env-var for the OS fingerprint (per-job, opt-in). */
const CAMOUFOX_OS_ENV = 'CAMOUFOX_OS';

/** Frozen non-overridable Camoufox launch settings shared by every run. */
const CAMOUFOX_PINNED = Object.freeze({
  locale: ISRAEL_LOCALE,
});

/**
 * Pinned window dimensions — kept as a fresh mutable tuple per call because
 * Camoufox's `LaunchOptions.window` is typed `[number, number]` (mutable).
 * @returns Mutable `[width, height]` tuple at the pinned desktop dimensions.
 */
function pinnedWindow(): [number, number] {
  return [DESKTOP_VIEWPORT_WIDTH, DESKTOP_VIEWPORT_HEIGHT];
}

/**
 * Resolve the three anti-detect knobs from {@link CAMOUFOX_KNOBS} into a
 * concrete options patch. Extracted so {@link buildLaunchOptions}
 * stays a thin assembler under the per-function cap.
 *
 * @returns Patch of `{ humanize, disable_coop, block_webrtc }` flags
 *   resolved against their CI bisect env-vars + production defaults.
 */
function resolveKnobs(): Pick<CamoufoxLaunchOptions, 'humanize' | 'disable_coop' | 'block_webrtc'> {
  return {
    humanize: envFlag(CAMOUFOX_KNOBS.humanize.envVar, CAMOUFOX_KNOBS.humanize.default),
    disable_coop: envFlag(CAMOUFOX_KNOBS.disable_coop.envVar, CAMOUFOX_KNOBS.disable_coop.default),
    block_webrtc: envFlag(CAMOUFOX_KNOBS.block_webrtc.envVar, CAMOUFOX_KNOBS.block_webrtc.default),
  };
}

/**
 * Resolve the Camoufox OS fingerprint from {@link CAMOUFOX_OS_ENV},
 * defaulting to {@link DEFAULT_CAMOUFOX_OS} (Windows — the all-banks-green
 * baseline). A CI bisect sets `CAMOUFOX_OS=linux` on the Amex E2E-real job
 * ALONE to test whether a host-matching Linux fingerprint clears the
 * datacenter-IP WAF, leaving every other bank on the proven Windows
 * fingerprint. An unset or unrecognised value falls back to Windows.
 *
 * @returns A valid Camoufox `os` value.
 */
function resolveOs(): CamoufoxOs {
  const raw = process.env[CAMOUFOX_OS_ENV]?.toLowerCase();
  return VALID_CAMOUFOX_OS.find(value => value === raw) ?? DEFAULT_CAMOUFOX_OS;
}

/**
 * Build the Camoufox launch options bundle. Centralised so the
 * `humanize` + `disable_coop` anti-detect knobs and the pinned
 * 1920x1080 window fingerprint stay in ONE place, locked-in by
 * the {@link "../../../../Tests/Unit/Common/CamoufoxLauncherKnobs.test.ts"}
 * drift canary.
 *
 * <p>Knob defaults + their CI bisect env-vars live in the
 * {@link CAMOUFOX_KNOBS} readonly table; pinned non-overridable settings
 * (locale/window) live in {@link CAMOUFOX_PINNED}; the OS fingerprint
 * defaults to Windows via {@link resolveOs} and is the one fingerprint
 * field a CI bisect overrides ({@link CAMOUFOX_OS_ENV}).
 *
 * <p>NOTE: `headless: 'virtual'` (Xvfb-backed display on Linux) is
 * intentionally NOT enabled by default — Camoufox throws
 * `CannotFindXvfb` when the host lacks `xvfb`, and CI runners +
 * `docker/Dockerfile.ci-mirror` do not currently install it.
 *
 * @param headless - Whether to launch in headless mode.
 * @returns Options object passed to `Camoufox()`.
 */
export function buildLaunchOptions(headless: boolean): CamoufoxLaunchOptions {
  return {
    headless,
    ...CAMOUFOX_PINNED,
    os: resolveOs(),
    window: pinnedWindow(),
    ...resolveKnobs(),
    screen: PINNED_SCREEN_CONSTRAINT,
  };
}

/**
 * Failure signatures emitted when camoufox-js cannot load the native
 * `better-sqlite3` binding it uses for WebGL fingerprint sampling.
 *
 * The `bindings` package throws "Could not locate the bindings file";
 * a partially-built or architecture-mismatched artefact surfaces as a
 * module-resolution or ELF-header error instead.
 */
const NATIVE_BINDING_FAILURE =
  /Could not locate the bindings file|better_sqlite3\.node|invalid ELF header/i;

/**
 * Actionable remedy for a missing native binding.
 *
 * Written for the case that actually bites: an install performed with
 * `--ignore-scripts`, which skips better-sqlite3's prebuild download and
 * leaves camoufox-js unable to start the browser.
 */
const NATIVE_BINDING_REMEDY = [
  'Camoufox could not start: the native better-sqlite3 binding is missing.',
  'camoufox-js requires it for WebGL fingerprint sampling.',
  'Fix: run `npm rebuild better-sqlite3`.',
  'If that build fails on Linux, install the toolchain first:',
  '`sudo apt-get install -y python3 make g++`.',
  'Note: installing with `--ignore-scripts` skips the prebuild and causes this.',
].join(' ');

/**
 * Replace an opaque native-binding failure with an actionable one.
 *
 * Any other failure is passed through untouched so real launch errors
 * are never masked by this diagnostic.
 *
 * @param error - The error thrown while importing or launching Camoufox.
 * @returns An enriched error for binding failures, else the original.
 * @internal Exported for unit testing; not part of the public API.
 */
export function withNativeBindingDiagnostic(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (!NATIVE_BINDING_FAILURE.test(message)) {
    return error;
  }
  return new Error(NATIVE_BINDING_REMEDY, { cause: error });
}

/**
 * Env var overriding {@link DEFAULT_CAMOUFOX_LAUNCH_TIMEOUT_MS}.
 *
 * Raise it on a slow link where Camoufox still has to download its ~1.3 GB
 * browser bundle on first launch.
 */
export const CAMOUFOX_LAUNCH_TIMEOUT_ENV = 'CAMOUFOX_LAUNCH_TIMEOUT_MS';

/**
 * Upper bound on a Camoufox launch, in milliseconds.
 *
 * Deliberately generous: a cold cache downloads the browser bundle during
 * the first launch, so a tight bound would abort a legitimate install.
 */
export const DEFAULT_CAMOUFOX_LAUNCH_TIMEOUT_MS = 300_000;

/**
 * Resolve the launch bound from {@link CAMOUFOX_LAUNCH_TIMEOUT_ENV}.
 *
 * @returns A positive millisecond bound; the default for unset or invalid values.
 */
function resolveLaunchTimeoutMs(): number {
  const raw = Number(process.env[CAMOUFOX_LAUNCH_TIMEOUT_ENV]);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CAMOUFOX_LAUNCH_TIMEOUT_MS;
}

/**
 * Build the message for a launch that exceeded its bound.
 *
 * Deliberately not exported: Rule #15 reserves module boundaries for
 * nominal types, and the message is verifiable through the rejection
 * that {@link withLaunchBound} produces.
 *
 * @param timeoutMs - The bound that was exceeded.
 * @returns Operator-facing text naming the likely causes and the override.
 */
function launchTimeoutMessage(timeoutMs: number): string {
  return [
    `Camoufox did not finish launching within ${String(timeoutMs)}ms.`,
    'Common causes: the browser bundle is still downloading on a cold cache,',
    'a required native dependency is missing, or the browser process died on startup.',
    `Raise ${CAMOUFOX_LAUNCH_TIMEOUT_ENV} if a first-run download needs longer.`,
  ].join(' ');
}

/**
 * Import camoufox-js and start the browser, with no bound of its own.
 *
 * Separated so {@link launchCamoufox} stays a thin timeout wrapper.
 *
 * @param headless - Whether to launch in headless mode.
 * @returns A Playwright-compatible Browser instance.
 */
async function startCamoufox(headless: boolean): Promise<Browser> {
  const camoufoxModule = await import('@hieutran094/camoufox-js');
  const launchOptions = buildLaunchOptions(headless);
  return camoufoxModule.Camoufox(launchOptions);
}

/**
 * Bound an in-flight launch so it can never stay unsettled.
 *
 * Delegates to the shared {@link timeoutPromise} primitive, which cancels
 * its timer once the race settles so a pending bound can never outlive the
 * call that created it. Kept generic and injectable so the bounding policy
 * is unit-testable without starting a browser process.
 *
 * @param launch - The in-flight launch promise.
 * @param timeoutMs - Millisecond bound to apply.
 * @returns The launch result when it wins the race.
 * @throws TimeoutError carrying {@link launchTimeoutMessage} when the bound elapses.
 */
export function withLaunchBound<T>(launch: Promise<T>, timeoutMs: number): Promise<T> {
  const message = launchTimeoutMessage(timeoutMs);
  return timeoutPromise(timeoutMs, launch, message);
}

/**
 * Close a browser that arrives after its launch bound already elapsed.
 *
 * <p>{@link withLaunchBound} races the launch against a timer, so losing
 * the race abandons — but does not cancel — the launch. A browser that
 * finishes starting afterwards would otherwise stay open with no reference
 * to close it, leaking a Firefox process for the life of the host process.
 * Every outcome is swallowed: this runs on a path that is already failing,
 * and the timeout is the error the caller must see.
 *
 * @param launch - The abandoned launch promise.
 * @returns True once a late browser was closed; false when the launch
 *   itself failed or the close did.
 */
function closeAbandonedLaunch(launch: Promise<Browser>): Promise<boolean> {
  const closed = launch.then(browser => browser.close());
  return closed.then(
    () => true,
    () => false,
  );
}

/**
 * Launch a Camoufox browser (Firefox with C++-level anti-detect stealth).
 * Uses dynamic import() because camoufox-js is ESM-only.
 *
 * Pins window/screen to a deterministic 1920x1080 desktop fingerprint
 * (OS fingerprint defaults to Windows; see {@link resolveOs}) so banks
 * cannot serve mobile content via screen-size heuristics. Without
 * this, Camoufox randomly picks per launch and an unlucky fingerprint can
 * trip the bank's mobile detection (observed: Isracard post-login splash
 * to /Sta… mobile-app upsell on small-screen fingerprint).
 *
 * Camoufox's `screen` option is a constraint pair (min/max); setting min
 * equal to max forces the exact desktop dimensions every run.
 *
 * <p>Also enables the documented Cloudflare-managed-challenge auto-pass
 * knobs (`humanize` + `disable_coop`) — see {@link buildLaunchOptions}
 * for rationale + the dangling-commit history (1708ba39) that proved
 * these knobs auto-pass Cloudflare/Incapsula adaptive scoring on
 * Bank Hapoalim + Amex.
 *
 * <p>The launch is bounded by {@link DEFAULT_CAMOUFOX_LAUNCH_TIMEOUT_MS}.
 * Without a bound, a browser that never comes up leaves this promise
 * permanently unsettled; the event loop then drains and an ESM caller
 * using top-level await dies with a bare `exit 13` and no diagnosis.
 * The bound converts that silence into an actionable rejection, and
 * {@link closeAbandonedLaunch} disposes of a browser that still arrives
 * after the bound elapsed.
 *
 * @param headless - Whether to launch in headless mode.
 * @returns A Playwright-compatible Browser instance.
 * @throws Error naming the native-binding remedy when better-sqlite3 is
 *   unavailable, or {@link launchTimeoutMessage} when the bound elapses.
 */
export async function launchCamoufox(headless: boolean): Promise<Browser> {
  const launch = startCamoufox(headless);
  const timeoutMs = resolveLaunchTimeoutMs();
  try {
    return await withLaunchBound(launch, timeoutMs);
  } catch (error) {
    closeAbandonedLaunch(launch).catch(() => false);
    throw withNativeBindingDiagnostic(error);
  }
}
