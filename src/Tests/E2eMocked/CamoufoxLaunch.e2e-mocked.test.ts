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

/** One row of the `isBenignLaunchFailure` contract matrix. `input`
 *  is the value passed to the helper (Error instance or non-Error
 *  rejection); `expected` is the assertion target. `note` carries
 *  the WHY for cases whose intent isn't obvious from the input
 *  alone — review-readable per `coding-principle.md` and the
 *  CLAUDE.md `Generic over duplication` rule. */
interface IBenignLaunchCase {
  readonly id: string;
  readonly input: unknown;
  readonly expected: boolean;
  readonly note: string;
}

/** Every fragment in `BENIGN_LAUNCH_ERROR_FRAGMENTS` has at least one
 *  positive row here, and the regression rows pin the contract that
 *  unrelated Playwright launch failures DO NOT match. CodeRabbit
 *  review on PR #230 — "ensure complete coverage of all defined
 *  benign patterns". */
const BENIGN_LAUNCH_CASES: readonly IBenignLaunchCase[] = [
  {
    id: 'BLF-MISSING-ENOENT',
    input: new Error('spawn /opt/camoufox: ENOENT'),
    expected: true,
    note: "POSIX ENOENT — Node's spawn() rejection when the binary path doesn't exist",
  },
  {
    id: 'BLF-MISSING-NSFOD',
    input: new Error('Error: ENOENT: no such file or directory, open /opt/camoufox/firefox'),
    expected: true,
    note: 'POSIX fs error phrasing — distinct from the bare `ENOENT` token',
  },
  {
    id: 'BLF-MISSING-EXEC-LOWER',
    input: new Error('install error: executable does not exist at the expected path'),
    expected: true,
    note: 'lowercase variant — distinct from the Playwright capitalised wording',
  },
  {
    id: 'BLF-MISSING-EXEC-PW',
    input: new Error("browserType.launch: Executable doesn't exist at /opt/camoufox/firefox"),
    expected: true,
    note: "Playwright's standard capitalised wording (apostrophe form)",
  },
  {
    id: 'BLF-MISSING-NOT-INSTALLED',
    input: new Error('browserType.launch: Chromium browser is not installed'),
    expected: true,
    note: 'Playwright wording when the host has no browser binary cached',
  },
  {
    id: 'BLF-REGRESSION-PAGE-CLOSED',
    input: new Error('browserType.launch: Page closed'),
    expected: false,
    note: "would have been swallowed by the prior `'browserType.launch'` over-broad fragment",
  },
  {
    id: 'BLF-REGRESSION-TARGET-CLOSED',
    input: new Error('browserType.launch: Target page, context or browser has been closed'),
    expected: false,
    note: 'common real-regression Playwright wording — must not be swallowed',
  },
  {
    id: 'BLF-REGRESSION-OPAQUE',
    input: 'some opaque rejection',
    expected: false,
    note: 'non-Error rejection without any benign fragment — must bubble',
  },
];

describe('isBenignLaunchFailure — narrow benign fragments only', () => {
  it.each(BENIGN_LAUNCH_CASES)(
    '$id returns $expected ($note)',
    (testCase: IBenignLaunchCase): void => {
      const isBenign = isBenignLaunchFailure(testCase.input);
      expect(isBenign).toBe(testCase.expected);
    },
  );
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
