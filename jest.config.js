/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  clearMocks: true,
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
  transformIgnorePatterns: ['/node_modules/(?!@faker-js/faker)'],
  setupFilesAfterEnv: ['./Tests/JestSetup.ts'],
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', 'E2ePublic/', 'E2eCredentials/', 'E2eOtp/', 'E2eSmoke/', 'E2eFull/'],
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
