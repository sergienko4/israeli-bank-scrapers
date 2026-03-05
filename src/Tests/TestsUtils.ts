import { Parser } from '@json2csv/plainjs';
import fs from 'fs';
import moment from 'moment';
import path from 'path';

import { ScraperWebsiteChangedError } from '../Scrapers/Base/ScraperWebsiteChangedError';
import { type TransactionsAccount } from '../Transactions';

export interface TestsConfig {
  companyAPI: {
    enabled: boolean;
    excelFilesDist?: string;
    invalidPassword?: boolean;
    [key: string]: unknown;
  };
  credentials: Record<string, unknown>;
  options?: Record<string, unknown>;
  [key: string]: unknown;
}

let testsConfig: TestsConfig | undefined;
let isConfigurationLoaded = false;

const MISSING_ERROR_MESSAGE =
  'Missing test environment configuration. To troubleshoot this issue open CONTRIBUTING.md file and read the "F.A.Q regarding the tests" section.';

export function getTestsConfig(): TestsConfig {
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
      testsConfig = JSON.parse(environmentConfig) as TestsConfig;
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    testsConfig = require(configPath) as TestsConfig;
    return testsConfig;
  } catch (e) {
    console.error(e);
    throw new ScraperWebsiteChangedError('TestContext', MISSING_ERROR_MESSAGE);
  }
}

export function maybeTestCompanyAPI(
  scraperId: string,
  filter?: (_config: TestsConfig) => boolean | undefined,
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

export function extendAsyncTimeout(timeout = 120000): void {
  jest.setTimeout(timeout);
}

export function exportTransactions(fileName: string, accounts: TransactionsAccount[]): void {
  const config = getTestsConfig();

  if (
    !config.companyAPI.enabled ||
    !config.companyAPI.excelFilesDist ||
    !fs.existsSync(config.companyAPI.excelFilesDist)
  ) {
    return;
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
  const filePath = `${path.join(config.companyAPI.excelFilesDist, fileName)}.csv`;
  fs.writeFileSync(filePath, csv);
}
