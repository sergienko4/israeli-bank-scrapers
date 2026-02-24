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
  collectCoverageFrom: [
    '**/*.ts',
    '!tests/**',
    '!**/*.test.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 3,
      functions: 3,
      lines: 20,
      statements: 20,
    },
  },
};

module.exports = config;
