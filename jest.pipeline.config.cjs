// Pipeline-only coverage config used by npm run test:pipeline.
// Mirrors jest.config.js with a narrowed collectCoverageFrom so the
// coverage gate measures the Pipeline folder only. Shell-independent.

module.exports = {
  preset: 'ts-jest/presets/default-esm',
  clearMocks: true,
  // Restart a worker once its heap exceeds this (checked after each test
  // file) so cross-suite memory accumulation over the 500+ suites cannot
  // OOM-crash a worker in CI (`Jest worker ran out of memory`). PR #404.
  workerIdleMemoryLimit: '512MB',
  coverageDirectory: 'coverage',
  rootDir: './src',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    // Escapes must be doubled: in a JS string `'\.'` collapses to `'.'`,
    // which turns the intended `\.js$` into "any char + js" and so also
    // strips `.mjs`. That broke dynamic imports of `scripts/*.mjs`, which
    // resolve through Node rather than through the mapper.
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
  testPathIgnorePatterns: [
    '/node_modules/',
    'E2ePublic/',
    'E2eCredentials/',
    'E2eOtp/',
    'E2eFull/',
  ],
  collectCoverageFrom: [
    '**/Scrapers/Pipeline/**/*.ts',
    '!**/*.test.ts',
    '!**/Tests/**',
  ],
  coveragePathIgnorePatterns: ['EslintCanaries'],
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: {
      // Phase 2 closeout (Seq #1): bumped from 95 -> 95.1 after adding
      // MethodBundles / ApiOriginDiscovery / JsonBody coverage tests
      // lifted measured branches from 94.98% -> 95.14% (effective
      // global excluding per-glob overrides: 95.11% -> 95.28%).
      branches: 95.1,
      functions: 97,
      lines: 98,
      statements: 97,
    },
  },
};
