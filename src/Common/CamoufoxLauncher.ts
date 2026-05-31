import type { LaunchOptions as CamoufoxLaunchOptions } from '@hieutran094/camoufox-js';
import type { Browser } from 'playwright-core';

import {
  DESKTOP_VIEWPORT_HEIGHT,
  DESKTOP_VIEWPORT_WIDTH,
  ISRAEL_LOCALE,
} from './Config/BrowserConfig.js';

export { ISRAEL_LOCALE } from './Config/BrowserConfig.js';

/** Truthy values for boolean env-var parsing in bisect experiments. */
const TRUTHY_ENV_VALUES: ReadonlySet<string> = new Set(['true', '1', 'yes', 'on']);

/**
 * Parse a boolean env var with a documented default. Used so CI can
 * flip individual Camoufox anti-detect knobs without a code edit
 * during bisect experiments. Production defaults stay `true` for
 * the documented Cloudflare-managed-challenge auto-pass recipe.
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
 * Build the Camoufox launch options bundle. Centralised so the
 * `humanize` + `disable_coop` anti-detect knobs and the pinned
 * Windows 1920x1080 fingerprint stay in ONE place, locked-in by
 * the {@link "../Tests/Unit/Common/CamoufoxLauncherKnobs.test.ts"}
 * drift canary.
 *
 * <p>`humanize: true` + `disable_coop: true` + `block_webrtc: true`
 * are the documented Camoufox knobs for Cloudflare-managed-challenge
 * auto-pass (https://camoufox.com/python/usage/) — proven on Amex
 * Cloudflare + Hapoalim Incapsula in the original cycle-3 forensic
 * run that was lost from main and restored by C11.
 *
 * <p>`block_webrtc` closes the WebRTC STUN IP-leak path that real
 * users without VPN never trigger; bot scorecards (Incapsula,
 * DataDome, PerimeterX) all flag WebRTC-revealed private IPs as a
 * high-confidence headless-Chromium / Selenium signal.
 *
 * <p>All three are env-overridable for bisect via `CAMOUFOX_HUMANIZE`
 * / `CAMOUFOX_DISABLE_COOP` / `CAMOUFOX_BLOCK_WEBRTC` (set to any of
 * `false`/`0`/`no`/`off` to disable a single knob without a code edit).
 *
 * <p>NOTE: `headless: 'virtual'` (Xvfb-backed display on Linux) is
 * intentionally NOT enabled by default — Camoufox throws
 * `CannotFindXvfb` when the host lacks `xvfb`, and CI runners +
 * `docker/Dockerfile.ci-mirror` do not currently install it.
 * Tracked as a follow-up; restoring virtual mode requires the
 * matching apt-install change in `.github/actions/install-camoufox/
 * action.yml` and the Dockerfile.
 *
 * @param headless - Whether to launch in headless mode.
 * @returns Options object passed to `Camoufox()`.
 */
function buildLaunchOptions(headless: boolean): CamoufoxLaunchOptions {
  return {
    headless,
    locale: ISRAEL_LOCALE,
    os: 'windows',
    humanize: envFlag('CAMOUFOX_HUMANIZE', true),
    disable_coop: envFlag('CAMOUFOX_DISABLE_COOP', true),
    block_webrtc: envFlag('CAMOUFOX_BLOCK_WEBRTC', true),
    window: [DESKTOP_VIEWPORT_WIDTH, DESKTOP_VIEWPORT_HEIGHT],
    screen: PINNED_SCREEN_CONSTRAINT,
  };
}

/**
 * Launch a Camoufox browser (Firefox with C++-level anti-detect stealth).
 * Uses dynamic import() because camoufox-js is ESM-only.
 *
 * Pins os/window/screen to a deterministic Windows 1920x1080 fingerprint
 * so banks cannot serve mobile content via screen-size heuristics. Without
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
 * @param headless - Whether to launch in headless mode.
 * @returns A Playwright-compatible Browser instance.
 */
export async function launchCamoufox(headless: boolean): Promise<Browser> {
  const camoufoxModule = await import('@hieutran094/camoufox-js');
  const options = buildLaunchOptions(headless);
  return camoufoxModule.Camoufox(options);
}

export { buildLaunchOptions, envFlag };
