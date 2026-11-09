import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { jest } from '@jest/globals';

import { ASYNC_TIMEOUT } from './Config/TestTimingConfig.js';

const FILE_NAME = fileURLToPath(import.meta.url);
const DIR_NAME = path.dirname(FILE_NAME);
const ESM_REQUIRE = createRequire(import.meta.url);

interface ITestsCompanyAPI {
  enabled: boolean;
  excelFilesDist?: string;
  invalidPassword?: boolean;
  [key: string]: boolean | string | undefined;
}

interface ITestsConfig {
  companyAPI: ITestsCompanyAPI;
  credentials: Record<string, Record<string, string>>;
  options?: Record<string, string>;
  [key: string]: ITestsCompanyAPI | Record<string, string | Record<string, string>> | undefined;
}

let testsConfig: ITestsConfig | undefined;
let isConfigurationLoaded = false;

const MISSING_ERROR_MESSAGE =
  'Missing test environment configuration. To troubleshoot this issue open CONTRIBUTING.md file and read the "F.A.Q regarding the tests" section.';

/** Custom error for test configuration issues. */
class TestConfigError extends Error {
  /**
   * Creates a new TestConfigError.
   * @param message - the error description
   * @param options - optional error cause
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TestConfigError';
  }
}

/**
 * Loads and returns the test configuration from env or file.
 * @returns the tests configuration object
 */
export function getTestsConfig(): ITestsConfig {
  if (isConfigurationLoaded) {
    if (!testsConfig) {
      throw new TestConfigError(MISSING_ERROR_MESSAGE);
    }

    return testsConfig;
  }

  isConfigurationLoaded = true;

  try {
    const environmentConfig = process.env.TESTS_CONFIG;
    if (environmentConfig) {
      testsConfig = JSON.parse(environmentConfig) as ITestsConfig;
      return testsConfig;
    }
  } catch (error) {
    const errorMessage = (error as Error).message;
    throw new TestConfigError(
      `failed to parse environment variable 'TESTS_CONFIG' with error '${errorMessage}'`,
      { cause: error },
    );
  }

  try {
    const configPath = path.join(DIR_NAME, '.tests-config.cjs');
    testsConfig = ESM_REQUIRE(configPath) as ITestsConfig;
    return testsConfig;
  } catch (error) {
    console.error(error);
    throw new TestConfigError(MISSING_ERROR_MESSAGE, { cause: error });
  }
}

/**
 * Extends the Jest async test timeout.
 * @param timeout - timeout in milliseconds, defaults to 120000
 * @returns true when the timeout has been set
 */
export function extendAsyncTimeout(timeout = ASYNC_TIMEOUT): boolean {
  jest.setTimeout(timeout);
  return true;
}
