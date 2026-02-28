// For a detailed explanation regarding each configuration property, visit:
// https://jestjs.io/docs/en/configuration.html
/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  clearMocks: true,
  coverageDirectory: 'coverage',
  rootDir: './src',
  transform: {
    '^.+\\.ts$': ['ts-jest'],
  },
  setupFilesAfterEnv: [
    './tests/jest-setup.ts',
  ],
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', 'e2e-real/', 'e2e-mocked/'],
  collectCoverageFrom: [
    '**/*.ts',
    '!tests/**',
    '!**/*.test.ts',
    // Extracted helper/type/fragment files — covered via scraper integration tests,
    // not unit-tested directly. Excluded to avoid false coverage drops on refactoring.
    '!scrapers/*-types.ts',
    '!scrapers/*-fragments.ts',
    '!scrapers/*-extra.ts',
    '!scrapers/*-helpers.ts',
    '!scrapers/beinleumi-account-selector.ts',
    '!scrapers/base-isracard-amex-transactions.ts',
    '!scrapers/concrete-generic-scraper.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 76,
      functions: 76,
      lines: 88,
      statements: 86,
    },
  },
};

module.exports = config;
