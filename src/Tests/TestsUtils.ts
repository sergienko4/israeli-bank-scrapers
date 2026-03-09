import { jest } from '@jest/globals';
import { Parser } from '@json2csv/plainjs';
import fs from 'fs';
import { createRequire } from 'module';
import moment from 'moment';
import path from 'path';
import { fileURLToPath } from 'url';

import { type ITransactionsAccount } from '../Transactions.js';

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
  } catch (err) {
    const errorMessage = (err as Error).message;
    throw new TestConfigError(
      `failed to parse environment variable 'TESTS_CONFIG' with error '${errorMessage}'`,
      { cause: err },
    );
  }

  try {
    const configPath = path.join(DIR_NAME, '.tests-config.cjs');
    testsConfig = ESM_REQUIRE(configPath) as ITestsConfig;
    return testsConfig;
  } catch (err) {
    console.error(err);
    throw new TestConfigError(MISSING_ERROR_MESSAGE, { cause: err });
  }
}

/**
 * Conditionally returns test or test.skip based on company API config.
 * @param scraperId - the scraper identifier to check
 * @param filter - optional filter function to further condition the test
 * @returns test function or test.skip
 */
export function maybeTestCompanyAPI(
  scraperId: string,
  filter?: (config: ITestsConfig) => boolean,
): typeof test {
  if (!isConfigurationLoaded) {
    getTestsConfig();
  }
  const hasCredentials = scraperId in (testsConfig?.credentials ?? {});
  return testsConfig &&
    testsConfig.companyAPI.enabled &&
    hasCredentials &&
    (!filter || filter(testsConfig))
    ? test
    : test.skip;
}

/**
 * Extends the Jest async test timeout.
 * @param timeout - timeout in milliseconds, defaults to 120000
 * @returns true when the timeout has been set
 */
export function extendAsyncTimeout(timeout = 120000): boolean {
  jest.setTimeout(timeout);
  return true;
}

interface ITransactionRow {
  account: string;
  balance: string;
  date: string;
  processedDate: string;
  [key: string]: unknown;
}

/**
 * Exports transaction data to a CSV file for test inspection.
 * @param fileName - the output file name (without extension)
 * @param accounts - the scraped transaction accounts to export
 * @returns true when export completes or is skipped
 */
export function exportTransactions(fileName: string, accounts: ITransactionsAccount[]): boolean {
  const config = getTestsConfig();

  if (
    !config.companyAPI.enabled ||
    !config.companyAPI.excelFilesDist ||
    !fs.existsSync(config.companyAPI.excelFilesDist)
  ) {
    return true;
  }

  let data: ITransactionRow[] = [];

  for (const account of accounts) {
    data = [
      ...data,
      ...account.txns.map(txn => {
        return {
          account: account.accountNumber,
          balance: `account balance: ${String(account.balance ?? '')}`,
          ...txn,
          date: moment(txn.date).format('DD/MM/YYYY'),
          processedDate: moment(txn.processedDate).format('DD/MM/YYYY'),
        };
      }),
    ];
  }

  if (data.length === 0) {
    data = [
      {
        account: '',
        balance: '',
        date: '',
        processedDate: '',
        comment: 'no transaction found for requested time frame',
      },
    ];
  }

  const parser = new Parser({ withBOM: true });
  const csv = parser.parse(data);
  const filePath = `${path.join(config.companyAPI.excelFilesDist, fileName)}.csv`;
  fs.writeFileSync(filePath, csv);
  return true;
}
