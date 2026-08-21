/**
 * Pin the test time zone.
 *
 * This config is evaluated in the parent process before any worker forks, so
 * workers inherit the value and honour it at startup — reassigning `TZ` from
 * inside a test does not work. Asia/Jerusalem is the zone every supported bank
 * reports in, and the zone the auto-mapper implicitly parses bank dates in.
 *
 * Without a pin, date behaviour differs between a maintainer's machine and a CI
 * runner (which defaults to UTC), and a whole class of window/boundary defects
 * is invisible on exactly one of the two.
 */
process.env.TZ = 'Asia/Jerusalem';

/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  clearMocks: true,
  // Restart a worker once its heap exceeds this (checked after each test
  // file) so cross-suite memory accumulation cannot OOM-crash a worker in
  // CI (`Jest worker ran out of memory`). PR #404.
  workerIdleMemoryLimit: '512MB',
  coverageDirectory: 'coverage',
  rootDir: './src',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@hieutran094/camoufox-js$': '<rootDir>/Tests/Mocks/CamoufoxJsMock.js',
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
  testPathIgnorePatterns: ['/node_modules/', 'E2ePublic/', 'E2eCredentials/', 'E2eOtp/', 'E2eFull/', 'Tests/Integration/'],
  collectCoverageFrom: ['**/*.ts', '!Tests/**', '!**/*.test.ts'],
  coveragePathIgnorePatterns: ['EslintCanaries'],
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
    global: {
      branches: 96,
      functions: 96,
      lines: 97,
      statements: 95,
    },
  },
};
