import { Parser } from '@json2csv/plainjs';
import fs from 'fs';
import { createRequire } from 'module';
import moment from 'moment';
import path from 'path';

import type { IDoneResult } from '../Interfaces/Common/StepResult';
import { ScraperWebsiteChangedError } from '../Scrapers/Base/ScraperWebsiteChangedError';
import { type ITransactionsAccount } from '../Transactions';

export interface ITestsConfig {
  companyAPI: {
    enabled: boolean;
    excelFilesDist?: string;
    invalidPassword?: boolean;
    [key: string]: string | boolean | undefined;
  };
  credentials: Record<string, string | Record<string, string>>;
  options?: Record<string, string | number | boolean>;
  [key: string]: unknown;
}

let testsConfig: ITestsConfig | undefined;
let isConfigurationLoaded = false;

const MISSING_ERROR_MESSAGE =
  'Missing test environment configuration. To troubleshoot this issue open CONTRIBUTING.md file and read the "F.A.Q regarding the tests" section.';

/**
 * Returns the loaded tests configuration, reading it from environment or file on first call.
 *
 * @returns the ITestsConfig object for the current test environment
 */
export function getTestsConfig(): ITestsConfig {
  if (isConfigurationLoaded) {
    if (!testsConfig) {
      throw new ScraperWebsiteChangedError('TestContext', MISSING_ERROR_MESSAGE);
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
  } catch (e) {
    throw new ScraperWebsiteChangedError(
      'TestContext',
      `failed to parse environment variable 'TESTS_CONFIG' with error '${(e as Error).message}'`,
    );
  }

  try {
    const configPath = path.join(__dirname, '.tests-config.js');
    const loadConfig = createRequire(__filename);
    testsConfig = loadConfig(configPath) as ITestsConfig;
    return testsConfig;
  } catch (e) {
    console.error(e);
    throw new ScraperWebsiteChangedError('TestContext', MISSING_ERROR_MESSAGE);
  }
}

/**
 * Returns the test or test.skip function based on whether the company API is enabled in config.
 *
 * @param scraperId - the scraper company identifier to check in the config credentials
 * @param filter - optional predicate that further gates the test based on config values
 * @returns the jest test function or test.skip depending on configuration
 */
export function maybeTestCompanyAPI(
  scraperId: string,
  filter?: (config: ITestsConfig) => boolean,
): jest.It {
  if (!isConfigurationLoaded) {
    getTestsConfig();
  }
  return testsConfig &&
    testsConfig.companyAPI.enabled &&
    testsConfig.credentials[scraperId] &&
    (!filter || filter(testsConfig))
    ? test
    : test.skip;
}

/**
 * Extends the Jest test timeout to allow for long async scraping operations.
 *
 * @param timeout - the timeout in milliseconds; defaults to 120000 (2 minutes)
 * @returns a done result
 */
export function extendAsyncTimeout(timeout = 120000): IDoneResult {
  jest.setTimeout(timeout);
  return { done: true };
}

/**
 * Exports scraped transactions to a CSV file in the configured output directory.
 *
 * @param fileName - the base file name (without extension) for the CSV output
 * @param accounts - the list of transaction accounts to serialize
 * @returns a done result
 */
export function exportTransactions(
  fileName: string,
  accounts: ITransactionsAccount[],
): IDoneResult {
  const config = getTestsConfig();

  if (
    !config.companyAPI.enabled ||
    !config.companyAPI.excelFilesDist ||
    !fs.existsSync(config.companyAPI.excelFilesDist)
  ) {
    return { done: true };
  }

  let data: {
    account: string;
    balance: string;
    date: string;
    processedDate: string;
    [key: string]: unknown;
  }[] = [];

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
  const distPath = config.companyAPI.excelFilesDist ?? '';
  const filePath = `${path.join(distPath, fileName)}.csv`;
  fs.writeFileSync(filePath, csv);
  return { done: true };
}
