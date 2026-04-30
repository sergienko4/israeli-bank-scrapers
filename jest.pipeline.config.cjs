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
    '!**/*.test.ts',
    '!**/Tests/**',
  ],
  coveragePathIgnorePatterns: ['EslintCanaries'],
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: {
      branches: 95,
      functions: 96,
      lines: 98,
      statements: 97,
    },
  },
};
