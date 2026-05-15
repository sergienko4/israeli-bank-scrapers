/**
 * Real-binary smoke test for `launchCamoufox` — verifies the wrapper
 * can spawn a Camoufox/Firefox process on the host and close it
 * cleanly. Sits in the `E2eMocked` tier (NOT pure unit) because it
 * touches a real OS binary and is therefore subject to host-side
 * launch latency / cache state / GPU sandbox issues.
 *
 * <p>Migrated out of `src/Tests/Unit/Pipeline/Mediator/Browser/
 * CamoufoxLauncher.test.ts` so the unit-test pipeline
 * (`test:pipeline`) stays deterministic and host-independent. The
 * unit file still asserts the wrapper's exports + async-function
 * shape; this file is the integration smoke.
 *
 * <p>The catch handler narrows to KNOWN missing-binary error
 * patterns only (ENOENT / executable-not-found / browser-not-
 * installed). Any OTHER rejection re-throws so real API regressions
 * or runtime bugs DO fail the test rather than being silently
 * swallowed (CodeRabbit review 2026-05-15).
 */

import { launchCamoufox } from '../../Scrapers/Pipeline/Mediator/Browser/CamoufoxLauncher.js';

/** Substrings that identify a launch failure caused by an absent
 *  binary — host has no Firefox/Camoufox installed (CI dependency
 *  install stage). Anything else is a real regression. */
const BENIGN_LAUNCH_ERROR_FRAGMENTS: readonly string[] = [
  'ENOENT',
  'no such file or directory',
  'executable does not exist',
  "Executable doesn't exist",
  'browser is not installed',
  'browserType.launch',
];

/**
 * Reports whether an error message matches a known missing-binary
 * pattern. Used by the launch-rejection guard to suppress only the
 * host-environment failure modes the test was designed to tolerate.
 *
 * @param error - Caught launch rejection.
 * @returns True when the error string contains a benign fragment.
 */
function isBenignLaunchFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return BENIGN_LAUNCH_ERROR_FRAGMENTS.some((fragment): boolean => message.includes(fragment));
}

describe('CamoufoxLauncher real-binary smoke', () => {
  it('invokes underlying Camoufox and closes browser if launched', async () => {
    // `false` sentinel keeps the rejection branch lint-compatible
    // with the project's "no `return undefined`" rule while still
    // distinguishing benign launch failures from real regressions
    // (real ones re-throw out of the catch).
    const browser = await launchCamoufox(true).catch((error: unknown): false => {
      if (isBenignLaunchFailure(error)) return false;
      throw error;
    });
    if (browser !== false) await browser.close();
    // The smoke contract: launchCamoufox either resolves to a
    // browser exposing `close()` OR rejects with a known
    // missing-binary error (suppressed above → `false`).
    // Anything else means the wrapper's contract drifted.
    const isContractOutcome = browser === false || typeof browser.close === 'function';
    expect(isContractOutcome).toBe(true);
  }, 60_000);
});
