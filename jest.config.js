/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  clearMocks: true,
  coverageDirectory: 'coverage',
  rootDir: './src',
  transform: {
    '^.+\\.ts$': ['ts-jest', { diagnostics: { ignoreDiagnostics: [151002] } }],
    '@faker-js.+\\.js$': [
      'ts-jest',
      { diagnostics: false, tsconfig: { allowJs: true, checkJs: false } },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!@faker-js/faker)'],
  moduleNameMapper: {
    '^@hieutran094/camoufox-js$': '<rootDir>/Tests/Mocks/CamoufoxJsMock.js',
  },
  setupFilesAfterEnv: ['./Tests/JestSetup.ts'],
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', 'E2ePublic/', 'E2eCredentials/', 'E2eOtp/'],
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
