import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Browser, BrowserContext } from 'playwright-core';

import {
  DESKTOP_VIEWPORT_HEIGHT,
  DESKTOP_VIEWPORT_WIDTH,
  ISRAEL_LOCALE,
  ISRAEL_TIMEZONE,
} from './Config/BrowserConfig.js';

export { ISRAEL_LOCALE } from './Config/BrowserConfig.js';

/** Per-platform headless override — see Pipeline/Mediator/Browser/CamoufoxLauncher.ts for rationale. */
const VIRTUAL_HEADLESS_PLATFORMS: Record<string, 'virtual'> = { linux: 'virtual' };

/** Truthy values for boolean env-var parsing in bisect experiments. */
const TRUTHY_ENV_VALUES: ReadonlySet<string> = new Set(['true', '1', 'yes', 'on']);

/**
 * Parse a boolean env var with a documented default. Used for bisect
 * experiments only — production defaults stay `true` for the three P0
 * knobs; setting `CAMOUFOX_HUMANIZE=false` (etc.) at run time disables
 * just that knob without a code edit.
 * @param name - Env var name.
 * @param fallback - Default when the env var is unset.
 * @returns Parsed boolean.
 */
function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const normalised = raw.toLowerCase();
  return TRUTHY_ENV_VALUES.has(normalised);
}

/**
 * Resolve Camoufox's headless mode for the current platform. Linux
 * headless maps to `"virtual"` unless `CAMOUFOX_VIRTUAL_HEADLESS=false`
 * is set (bisect / diagnostic override).
 * @param headless - Caller's headless intent.
 * @returns `false` when visible; `"virtual"` on Linux+headless+enabled; `true` otherwise.
 */
function resolveHeadlessMode(headless: boolean): boolean | 'virtual' {
  if (!headless) return false;
  if (!envFlag('CAMOUFOX_VIRTUAL_HEADLESS', true)) return true;
  return VIRTUAL_HEADLESS_PLATFORMS[process.platform] ?? true;
}

/**
 * Launch a Camoufox browser (Firefox with C++-level anti-detect stealth).
 * Uses dynamic import() because camoufox-js is ESM-only.
 *
 * Pins os/window/screen to a deterministic Windows 1920x1080 fingerprint
 * so banks cannot serve mobile content via screen-size heuristics. Mirrors
 * the same fix in src/Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.ts.
 *
 * `humanize: true` + `disable_coop: true` are the documented Camoufox
 * anti-detect knobs for Cloudflare managed challenges
 * (https://camoufox.com/python/usage/) — keep both launchers in sync.
 * @param headless - Whether to launch in headless mode.
 * @returns A Playwright-compatible Browser instance.
 */
export async function launchCamoufox(headless: boolean): Promise<Browser> {
  const camoufoxModule = await import('@hieutran094/camoufox-js');
  // `user_data_dir` is intentionally omitted — per Camoufox docs it
  // is only relevant when `persistent_context=True`, which we never
  // enable. camoufox-js's TS overloads tie `'virtual'` headless to a
  // user_data_dir-bearing variant, so we cast to bypass that quirk
  // without re-introducing the irrelevant `user_data_dir: undefined`.
  const options = buildEphemeralLaunchOptions(headless) as Parameters<
    typeof camoufoxModule.Camoufox
  >[0];
  return camoufoxModule.Camoufox(options);
}

/** Subdirectories inside a Firefox profile that we strip post-run. */
const STRIPPABLE_CACHE_SUBDIRS: readonly string[] = ['Cache', 'OfflineCache', 'cache2', 'crashes'];

/** Pinned screen-dimension constraint applied to every Camoufox launch. */
const PINNED_SCREEN_CONSTRAINT = {
  minWidth: DESKTOP_VIEWPORT_WIDTH,
  maxWidth: DESKTOP_VIEWPORT_WIDTH,
  minHeight: DESKTOP_VIEWPORT_HEIGHT,
  maxHeight: DESKTOP_VIEWPORT_HEIGHT,
};

/**
 * Build the canonical ephemeral Camoufox launch options.
 *
 * Shared baseline for both the legacy ephemeral path and the
 * persistent-profile path so both keep the same anti-detect knobs
 * (humanize / disable_coop / virtual / OS / locale / screen-pin /
 * window-size).
 * @param headless - Caller's headless intent.
 * @returns Options object accepted by `Camoufox()` (typed as opaque
 *   Record because camoufox-js's own type is a generic-heavy union).
 */
function buildEphemeralLaunchOptions(headless: boolean): Record<string, unknown> {
  return {
    headless: resolveHeadlessMode(headless),
    locale: ISRAEL_LOCALE,
    os: 'windows',
    humanize: envFlag('CAMOUFOX_HUMANIZE', true),
    disable_coop: envFlag('CAMOUFOX_DISABLE_COOP', true),
    window: [DESKTOP_VIEWPORT_WIDTH, DESKTOP_VIEWPORT_HEIGHT],
    screen: PINNED_SCREEN_CONSTRAINT,
  };
}

/**
 * Extend ephemeral launch options with context-level fields needed
 * when camoufox-js routes through `playwright.launchPersistentContext`.
 * @param headless - Caller's headless intent.
 * @param profileDir - Absolute path to the persistent profile dir.
 * @returns Options object accepted by `Camoufox()` in persistent mode.
 */
function buildPersistentLaunchOptions(
  headless: boolean,
  profileDir: string,
): Record<string, unknown> {
  return {
    ...buildEphemeralLaunchOptions(headless),
    user_data_dir: profileDir,
    timezoneId: ISRAEL_TIMEZONE,
    viewport: { width: DESKTOP_VIEWPORT_WIDTH, height: DESKTOP_VIEWPORT_HEIGHT },
    javaScriptEnabled: true,
  };
}

/**
 * Whether the persistent-profile mode is enabled for the current run.
 * Opt-in via `USE_PERSISTENT_PROFILES=true` — default is the legacy
 * ephemeral path (a fresh profile every launch) so existing local and
 * CI flows are unaffected.
 * @returns True when the env flag opts in.
 */
export function isPersistentProfilesEnabled(): boolean {
  return envFlag('USE_PERSISTENT_PROFILES', false);
}

/**
 * Canonical per-bank profile directory on the host.
 *
 * Layout: `~/.cache/isbs/profiles/<bank>/`. Local dev keeps the dir
 * forever (manual `RESET_PROFILES=1`-style cleanup at user discretion);
 * CI restores + saves it via `actions/cache` so a bank-specific cache
 * key carries the profile across runs (7-day natural eviction).
 * @param bank - Bank identifier (case-insensitive; coerced to lowercase).
 * @returns Absolute path to the profile directory.
 */
export function getProfileDir(bank: string): string {
  const home = os.homedir();
  const normalisedBank = bank.toLowerCase();
  return path.join(home, '.cache', 'isbs', 'profiles', normalisedBank);
}

/**
 * Remove Firefox cache subdirectories from a persistent profile.
 *
 * We keep cookies, LocalStorage, IndexedDB and prefs (the bits that
 * contribute to anti-detect maturity) and discard HTTP cache + offline
 * cache + cache2 + crashes (no anti-detect value, bloat the GH Actions
 * cache). Safe to call on a directory that does not yet exist or whose
 * subdirs are partially missing — each removal is force-mode.
 * @param profileDir - The profile directory to clean.
 * @returns Nothing.
 */
export function stripProfileCache(profileDir: string): true {
  for (const sub of STRIPPABLE_CACHE_SUBDIRS) {
    const target = path.join(profileDir, sub);
    fs.rmSync(target, { recursive: true, force: true });
  }
  return true;
}

/**
 * Build a single composite cleanup that (1) closes the launcher result
 * and (2) strips the persistent-profile cache when opted in. Pushed
 * onto caller cleanup arrays as a single entry so callers don't have
 * to know about the persistent-mode branching.
 * @param result - Launcher output (Browser or BrowserContext).
 * @param bank - Bank identifier driving the profile-cache strip.
 * @returns Async cleanup callable resolving to true on completion.
 */
export function buildCloseAndStripCleanup(
  result: Browser | BrowserContext,
  bank: string,
): () => Promise<true> {
  return async (): Promise<true> => {
    await result.close();
    if (isPersistentProfilesEnabled()) {
      const profileDir = getProfileDir(bank);
      stripProfileCache(profileDir);
    }
    return true;
  };
}

/**
 * Launch a Camoufox session for a specific bank, honouring the
 * `USE_PERSISTENT_PROFILES` opt-in.
 *
 * When opted in, returns a {@link BrowserContext} backed by
 * `~/.cache/isbs/profiles/<bank>/` so cookies + LocalStorage persist
 * across runs (improves Cloudflare scoring + device recognition for
 * banks that remember devices). When NOT opted in, delegates to the
 * legacy ephemeral {@link launchCamoufox} which returns a {@link Browser}.
 *
 * Callers must handle the union return type — typically via
 * `'newContext' in result` narrowing (the persistent path IS already
 * a context; the ephemeral path needs a `newContext()` call).
 * @param headless - Caller's headless intent.
 * @param bank - Bank identifier used to compute the profile path.
 * @returns Browser (ephemeral) or BrowserContext (persistent).
 */
export async function launchCamoufoxForBank(
  headless: boolean,
  bank: string,
): Promise<Browser | BrowserContext> {
  if (!isPersistentProfilesEnabled()) {
    return launchCamoufox(headless);
  }
  const profileDir = getProfileDir(bank);
  fs.mkdirSync(profileDir, { recursive: true });
  const camoufoxModule = await import('@hieutran094/camoufox-js');
  const options = buildPersistentLaunchOptions(headless, profileDir) as Parameters<
    typeof camoufoxModule.Camoufox
  >[0];
  return camoufoxModule.Camoufox(options);
}
