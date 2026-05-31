/**
 * Drift canary for `Common/CamoufoxLauncher.buildLaunchOptions` —
 * locks in the three anti-detect knobs (`humanize`, `disable_coop`,
 * `block_webrtc`) so they cannot be silently removed again the way
 * commit `1708ba39` was lost from main between 2026-05-18 and the
 * C11 restoration (10 days during which every Hapoalim E2E Real
 * run failed with an Incapsula hCaptcha challenge served at the
 * HOME GET).
 *
 * <p>Each knob has the well-known semantics:
 *   - `humanize: true` — C++-level cursor humanization on every
 *     `page.mouse.move` call (curved paths + timing variance).
 *   - `disable_coop: true` — Cross-Origin-Opener-Policy relaxation
 *     so adaptive challenge iframes (Cloudflare Turnstile, hCaptcha)
 *     are reachable from the bank's parent SPA.
 *   - `block_webrtc: true` — closes the WebRTC STUN private-IP leak
 *     path that real users without VPN never trigger.
 *
 * <p>Also pins the env-var override surface so the bisect knobs
 * `CAMOUFOX_HUMANIZE` / `CAMOUFOX_DISABLE_COOP` / `CAMOUFOX_BLOCK_WEBRTC`
 * cannot regress to "string compared to true" or similar typo bugs.
 */

import { buildLaunchOptions, envFlag } from '../../../Common/CamoufoxLauncher.js';

/** Anti-detect knobs that MUST stay `true` by default. */
const ANTI_DETECT_KNOBS = ['humanize', 'disable_coop', 'block_webrtc'] as const;

/** Env var names paired with their knobs (drift-pin for renames). */
const ENV_VAR_NAMES = [
  ['CAMOUFOX_HUMANIZE', 'humanize'],
  ['CAMOUFOX_DISABLE_COOP', 'disable_coop'],
  ['CAMOUFOX_BLOCK_WEBRTC', 'block_webrtc'],
] as const;

/** Env values that envFlag MUST treat as truthy. */
const TRUTHY_INPUTS = ['true', '1', 'yes', 'on', 'TRUE', 'YES', 'On'] as const;

/** Env values that envFlag MUST treat as falsy (anything not truthy). */
const FALSY_INPUTS = ['false', '0', 'no', 'off', 'disabled', ''] as const;

/** Sentinel marking a key that was unset in the original env. */
const UNSET_SENTINEL = '__UNSET_IN_ORIGINAL_ENV__';

/**
 * Snapshot the original env-var values so per-test mutations cannot
 * leak across the suite. Restored in `afterEach`.
 *
 * @returns Map of env-name to original value (or {@link UNSET_SENTINEL}
 *   when the key was not set when the suite started).
 */
function snapshotEnv(): Map<string, string> {
  const snap = new Map<string, string>();
  for (const [envName] of ENV_VAR_NAMES) {
    const raw = process.env[envName];
    snap.set(envName, raw ?? UNSET_SENTINEL);
  }
  return snap;
}

/**
 * Restore env-var values from a snapshot, removing keys that carry
 * the {@link UNSET_SENTINEL} so we never leak the sentinel string
 * into a subsequent test as if it were a real env value.
 *
 * @param snap - Map produced by `snapshotEnv`.
 * @returns True after restoration completes.
 */
function restoreEnv(snap: Map<string, string>): true {
  for (const [name, value] of snap) {
    if (value === UNSET_SENTINEL) {
      Reflect.deleteProperty(process.env, name);
    } else {
      process.env[name] = value;
    }
  }
  return true as const;
}

/**
 * Clear every env var in {@link ENV_VAR_NAMES} so the next
 * `buildLaunchOptions` call observes the production defaults.
 *
 * @returns True after clearing completes.
 */
function clearKnobEnvVars(): true {
  for (const [envName] of ENV_VAR_NAMES) {
    Reflect.deleteProperty(process.env, envName);
  }
  return true as const;
}

describe('CamoufoxLauncher knobs canary', () => {
  const initialEnv = snapshotEnv();

  afterEach(() => {
    restoreEnv(initialEnv);
  });

  describe('default knob values', () => {
    for (const knob of ANTI_DETECT_KNOBS) {
      it(`pins ${knob} = true by default (no env override)`, () => {
        clearKnobEnvVars();
        const opts = buildLaunchOptions(true);
        expect(opts[knob]).toBe(true);
      });
    }
  });

  describe('locale + os + headless pin', () => {
    it('forces locale to he-IL', () => {
      const opts = buildLaunchOptions(true);
      expect(opts.locale).toBe('he-IL');
    });

    it('forces os to windows', () => {
      const opts = buildLaunchOptions(true);
      expect(opts.os).toBe('windows');
    });

    it('passes through the headless argument verbatim', () => {
      const headlessTrue = buildLaunchOptions(true);
      const headlessFalse = buildLaunchOptions(false);
      expect(headlessTrue.headless).toBe(true);
      expect(headlessFalse.headless).toBe(false);
    });
  });

  describe('viewport + screen fingerprint pin', () => {
    it('pins window to [1920, 1080]', () => {
      const opts = buildLaunchOptions(true);
      expect(opts.window).toEqual([1920, 1080]);
    });

    it('pins screen min == max so Camoufox cannot randomise', () => {
      const opts = buildLaunchOptions(true);
      const screen = opts.screen as Record<string, number>;
      expect(screen.minWidth).toBe(screen.maxWidth);
      expect(screen.minHeight).toBe(screen.maxHeight);
      expect(screen.minWidth).toBe(1920);
      expect(screen.minHeight).toBe(1080);
    });
  });

  describe('env-flag bisect surface', () => {
    for (const [envName, knob] of ENV_VAR_NAMES) {
      it(`${envName} = 'false' disables ${knob}`, () => {
        process.env[envName] = 'false';
        const opts = buildLaunchOptions(true);
        expect(opts[knob]).toBe(false);
      });

      it(`${envName} unset keeps ${knob} on by default`, () => {
        Reflect.deleteProperty(process.env, envName);
        const opts = buildLaunchOptions(true);
        expect(opts[knob]).toBe(true);
      });
    }

    for (const truthy of TRUTHY_INPUTS) {
      it(`envFlag treats '${truthy}' as truthy`, () => {
        process.env.CAMOUFOX_HUMANIZE = truthy;
        const isTruthy = envFlag('CAMOUFOX_HUMANIZE', false);
        expect(isTruthy).toBe(true);
      });
    }

    for (const falsy of FALSY_INPUTS) {
      it(`envFlag treats '${falsy}' as falsy`, () => {
        process.env.CAMOUFOX_HUMANIZE = falsy;
        const isFalsy = envFlag('CAMOUFOX_HUMANIZE', true);
        expect(isFalsy).toBe(false);
      });
    }
  });

  describe('shape of returned options bundle', () => {
    it('returns a plain object with all 8 expected keys', () => {
      const opts = buildLaunchOptions(true);
      const keys = Object.keys(opts).sort();
      expect(keys).toEqual([
        'block_webrtc',
        'disable_coop',
        'headless',
        'humanize',
        'locale',
        'os',
        'screen',
        'window',
      ]);
    });

    it('does NOT include geoip (would break on Azure CI IPs)', () => {
      const opts = buildLaunchOptions(true);
      expect(opts).not.toHaveProperty('geoip');
    });

    it("does NOT include headless: 'virtual' (needs xvfb infra)", () => {
      const opts = buildLaunchOptions(true);
      expect(opts.headless).not.toBe('virtual');
    });
  });
});
