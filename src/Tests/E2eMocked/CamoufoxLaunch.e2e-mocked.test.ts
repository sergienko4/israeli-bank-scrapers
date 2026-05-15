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
 *  install stage). Anything else is a real regression.
 *
 *  CodeRabbit review on commit 2ed8a628 — `browserType.launch` was
 *  previously listed here as a benign fragment, but that token
 *  appears verbatim in EVERY Playwright launch error (success or
 *  failure). Including it in the allow-list silently swallowed
 *  real regressions like `browserType.launch: Page closed` /
 *  `Target closed`. The list now contains ONLY substrings that
 *  identify a missing-binary failure. */
const BENIGN_LAUNCH_ERROR_FRAGMENTS: readonly string[] = [
  'ENOENT',
  'no such file or directory',
  'executable does not exist',
  "Executable doesn't exist",
  'browser is not installed',
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

describe('isBenignLaunchFailure — narrow benign fragments only', () => {
  // CodeRabbit review on commit 2ed8a628 — `browserType.launch` was
  // listed as a benign fragment, but that token appears verbatim in
  // EVERY Playwright launch error (success or failure). Including
  // it in the allow-list silently swallowed real regressions such
  // as `browserType.launch: Page closed` / `Target closed` / etc.
  // The fragment list now contains ONLY substrings that identify a
  // missing-binary failure (ENOENT, no such file or directory,
  // executable-not-found phrasings).

  it('BLF-MISSING-001 matches the ENOENT error string', (): void => {
    const isBenign = isBenignLaunchFailure(new Error('spawn /opt/camoufox: ENOENT'));
    expect(isBenign).toBe(true);
  });

  it('BLF-MISSING-002 matches the "Executable doesn\'t exist" Playwright wording', (): void => {
    const isBenign = isBenignLaunchFailure(
      new Error("browserType.launch: Executable doesn't exist at /opt/camoufox/firefox"),
    );
    expect(isBenign).toBe(true);
  });

  it('BLF-MISSING-003 matches the "browser is not installed" Playwright wording', (): void => {
    const isBenign = isBenignLaunchFailure(
      new Error('browserType.launch: Chromium browser is not installed'),
    );
    expect(isBenign).toBe(true);
  });

  it('BLF-REGRESSION-001 does NOT swallow Page-closed Playwright failures', (): void => {
    const isBenign = isBenignLaunchFailure(new Error('browserType.launch: Page closed'));
    expect(isBenign).toBe(false);
  });

  it('BLF-REGRESSION-002 does NOT swallow generic Playwright launch crashes', (): void => {
    const isBenign = isBenignLaunchFailure(
      new Error('browserType.launch: Target page, context or browser has been closed'),
    );
    expect(isBenign).toBe(false);
  });

  it('BLF-REGRESSION-003 does NOT swallow non-Error rejections that lack any benign fragment', (): void => {
    const isBenign = isBenignLaunchFailure('some opaque rejection');
    expect(isBenign).toBe(false);
  });
});

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
