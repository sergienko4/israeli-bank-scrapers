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
  testPathIgnorePatterns: ['/node_modules/', 'e2e-real\\.test\\.ts$'],
  collectCoverageFrom: [
    '**/*.ts',
    '!tests/**',
    '!**/*.test.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 73,
      functions: 74,
      lines: 87,
      statements: 85,
    },
  },
};

module.exports = config;
