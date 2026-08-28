/**
 * Config for the parallel unit run.
 *
 * Exists because Jest's `--testPathIgnorePatterns` CLI flag REPLACES the
 * config's value instead of extending it. `test:unit` used to pass the flag
 * three times to hide the E2E suites, and in doing so discarded every
 * exclusion `jest.config.js` declared — pulling twelve serial-only integration
 * suites into a run that gives each of them a worker pool they explicitly opt
 * out of. Nothing failed; the run just took about five minutes instead of the
 * measured 2m42s it takes once they are out of it.
 *
 * Expect the first run or two against this config to be SLOWER, not faster.
 * Jest keys its per-file timing cache on the config, so a new config starts
 * with no timings, falls back to ordering by file size, and packs the workers
 * badly until it has learned. Measured here: 7m28s, then 6m22s, then 2m42s,
 * stable thereafter. Nothing is wrong; it is still learning.
 *
 * Spreading the base config removes the trap from the config layer: a pattern
 * added to `jest.config.js` reaches this run without anyone remembering to copy
 * it, and nothing here can drop one. The CLI flag still replaces this list if a
 * caller passes it, so the guarantee is about the config, not about every way
 * the run can be invoked — `scripts/check-jest-scopes.mjs` is what watches the
 * scripts.
 *
 * The additions are the suites that need real credentials or a real browser,
 * which is why they cannot run in the parallel pool. Each is anchored to a path
 * boundary, which matters: the old CLI flag passed a bare `E2eReal`, and that
 * also swallowed the three ordinary `Tests/Unit/E2eReal*.test.ts` unit suites,
 * which have always been safe to run here and now do. `Tests/E2e.test.ts` is one
 * of them despite its unassuming name: past the factory assertions at the top
 * it drives a real browser against Hapoalim's live site, which is why it owns a
 * 300 s timeout, its own `test:e2e-factory-tests` script and its own CI job, and
 * why `test:pipeline` excludes it too. A local unit run must not reach for the
 * network, so it is hidden here on the same grounds. That last pattern is
 * anchored to a path boundary and an end-of-name, so it hides exactly the one
 * file and not some future `OtherTests/E2e.test.ts`; the separator class keeps
 * it working on both POSIX and Windows paths.
 */
import base from './jest.config.js';

/** @type {import('jest').Config} */
export default {
  ...base,
  testPathIgnorePatterns: [
    ...base.testPathIgnorePatterns,
    'E2eReal/',
    'E2eMocked/',
    '[\\\\/]Tests[\\\\/]E2e\\.test\\.ts$',
  ],
};
