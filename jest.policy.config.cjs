/**
 * Config for the CI-policy gate suites.
 *
 * The 29 files under `src/Tests/Policy/` assert invariants about GitHub
 * workflows, release policy, CI scripts and dependency-update policy. They are
 * not product unit tests: they never import the scrapers, they read the repo
 * as text, and a failure means "the guardrail drifted", not "the pipeline
 * broke". Keeping them in the parallel unit run made that distinction
 * invisible and tied a policy review to the product test count.
 *
 * The settings are copied from `jest.config.js` deliberately. This run must
 * behave exactly like the base config did for these files — same TypeScript
 * transform, same module resolution, same setup file, same time zone — because
 * they moved out of the unit tree, not out of the suite they belong to.
 * `jest.config.js` is ESM, so it cannot be `require`d here; if the base config
 * changes, keep this one in step.
 */
process.env.TZ = 'Asia/Jerusalem';

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  clearMocks: true,
  workerIdleMemoryLimit: '512MB',
  rootDir: './src',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
    '@faker-js.+\\.js$': [
      'ts-jest',
      { useESM: true, diagnostics: false, tsconfig: { allowJs: true, checkJs: false } },
    ],
  },
  setupFilesAfterEnv: ['./Tests/JestSetup.ts'],
  testEnvironment: 'node',
  // `testMatch`, not `testPathIgnorePatterns`: this project exists to run these
  // files and nothing else, so a new test directory cannot silently join it.
  testMatch: ['<rootDir>/Tests/Policy/**/*.test.ts'],
};
