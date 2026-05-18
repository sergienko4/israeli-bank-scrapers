import type { Browser } from 'playwright-core';

import {
  DESKTOP_VIEWPORT_HEIGHT,
  DESKTOP_VIEWPORT_WIDTH,
  ISRAEL_LOCALE,
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
  const options: Parameters<typeof camoufoxModule.Camoufox>[0] = {
    headless: resolveHeadlessMode(headless),
    locale: ISRAEL_LOCALE,
    os: 'windows',
    humanize: envFlag('CAMOUFOX_HUMANIZE', true),
    disable_coop: envFlag('CAMOUFOX_DISABLE_COOP', true),
    window: [DESKTOP_VIEWPORT_WIDTH, DESKTOP_VIEWPORT_HEIGHT],
    screen: {
      minWidth: DESKTOP_VIEWPORT_WIDTH,
      maxWidth: DESKTOP_VIEWPORT_WIDTH,
      minHeight: DESKTOP_VIEWPORT_HEIGHT,
      maxHeight: DESKTOP_VIEWPORT_HEIGHT,
    },
  } as Parameters<typeof camoufoxModule.Camoufox>[0];
  return camoufoxModule.Camoufox(options);
}
