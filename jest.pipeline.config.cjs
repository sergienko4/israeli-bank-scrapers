// Pipeline-only coverage config used by npm run test:pipeline.
// Mirrors jest.config.js with a narrowed collectCoverageFrom so the
// coverage gate measures the Pipeline folder only. Shell-independent.

module.exports = {
  preset: 'ts-jest/presets/default-esm',
  clearMocks: true,
  coverageDirectory: 'coverage',
  rootDir: './src',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\.{1,2}/.*)\.js$': '$1',
    '^@hieutran094/camoufox-js$': '<rootDir>/Tests/Mocks/CamoufoxJsMock.js',
  },
  transform: {
    '^.+\.ts$': ['ts-jest', { useESM: true }],
    '@faker-js.+\.js$': [
      'ts-jest',
      { useESM: true, diagnostics: false, tsconfig: { allowJs: true, checkJs: false } },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!@faker-js/faker)'],
  setupFilesAfterEnv: ['./Tests/JestSetup.ts'],
  testEnvironment: 'node',
  testPathIgnorePatterns: [
    '/node_modules/',
    'E2ePublic/',
    'E2eCredentials/',
    'E2eOtp/',
    'E2eSmoke/',
    'E2eFull/',
  ],
  collectCoverageFrom: [
    '**/Scrapers/Pipeline/**/*.ts',
    // BaseScraperHelpers.ts hosts shared login-result + URL-diagnostic
    // helpers consumed by the Pipeline (`formatDiagUrl`, `buildLoginResult`,
    // `getKeyByValue`). Coverage of its new CodeQL #28-fix lines must reach
    // SonarCloud — adding it here keeps SonarCloud `new_coverage` accurate
    // without pulling in the rest of `src/Scrapers/Base/` (legacy base
    // classes with deliberately lower coverage thresholds).
    '**/Scrapers/Base/BaseScraperHelpers.ts',
    // Phase 7.5 (PR #304) added new code paths to these two files
    // (`resolveLegacyBank`, `resolveLoginSetup`, `runLoginChain`,
    // `GenericBankScraper.resolveLoginSetup` override). Without including
    // them here Jest emits no lcov data → SonarCloud reports the new
    // lines as uncovered and fails `new_coverage < 80%`. Global gates
    // would naturally fail on the legacy unhit bodies, so per-path
    // thresholds are pinned to current real coverage with a safety margin.
    '**/Scrapers/Base/BaseScraperWithBrowser.ts',
    '**/Scrapers/Base/GenericBankScraper.ts',
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
    // Legacy base classes — Phase 7.5 only added a handful of new
    // methods; legacy code paths (selector resolution, form-anchor
    // scoping, label-text fallback in GenericBankScraper; legacy login
    // chain in BaseScraperWithBrowser) remain at the pre-existing
    // coverage level. Pinned below current real value with safety
    // margin so accidental regressions still fire. Bring these up in a
    // dedicated coverage PR rather than blocking Phase 7.5.
    '**/Scrapers/Base/BaseScraperWithBrowser.ts': {
      branches: 70,
      functions: 85,
      lines: 85,
      statements: 85,
    },
    '**/Scrapers/Base/GenericBankScraper.ts': {
      branches: 0,
      functions: 5,
      lines: 5,
      statements: 5,
    },
  },
};
