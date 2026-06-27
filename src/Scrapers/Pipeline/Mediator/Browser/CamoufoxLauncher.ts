import type { LaunchOptions as CamoufoxLaunchOptions } from '@hieutran094/camoufox-js';
import type { Browser } from 'playwright-core';

import {
  DESKTOP_VIEWPORT_HEIGHT,
  DESKTOP_VIEWPORT_WIDTH,
  ISRAEL_LOCALE,
} from '../../../../Common/Config/BrowserConfig.js';
import type { Brand } from '../../Types/Brand.js';

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

/** Frozen non-overridable Camoufox launch settings shared by every run. */
const CAMOUFOX_PINNED = Object.freeze({
  locale: ISRAEL_LOCALE,
  os: 'windows' as const,
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
 * Build the Camoufox launch options bundle. Centralised so the
 * `humanize` + `disable_coop` anti-detect knobs and the pinned
 * Windows 1920x1080 fingerprint stay in ONE place, locked-in by
 * the {@link "../../../../Tests/Unit/Common/CamoufoxLauncherKnobs.test.ts"}
 * drift canary.
 *
 * <p>Knob defaults + their CI bisect env-vars live in the
 * {@link CAMOUFOX_KNOBS} readonly table; pinned non-overridable settings
 * (locale/os/window) live in {@link CAMOUFOX_PINNED}.
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
    window: pinnedWindow(),
    ...resolveKnobs(),
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
