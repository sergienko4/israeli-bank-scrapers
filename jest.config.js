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
    '@faker-js.+\\.js$': [
      'ts-jest',
      { diagnostics: false, tsconfig: { allowJs: true, checkJs: false } },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!@faker-js/faker)'],
  setupFilesAfterEnv: ['./Tests/JestSetup.ts'],
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', 'E2ePublic/', 'E2eCredentials/', 'E2eMocked/'],
  collectCoverageFrom: ['**/*.ts', '!Tests/**', '!**/*.test.ts'],
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
