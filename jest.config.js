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
  testPathIgnorePatterns: ['/node_modules/', 'e2e-real\\.test\\.ts$', 'e2e-mocked/'],
  collectCoverageFrom: [
    '**/*.ts',
    '!tests/**',
    '!**/*.test.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 77,
      functions: 76,
      lines: 89,
      statements: 87,
    },
  },
};

module.exports = config;
