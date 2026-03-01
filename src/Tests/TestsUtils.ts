import { Parser } from '@json2csv/plainjs';
import fs from 'fs';
import moment from 'moment';
import path from 'path';

import { type TransactionsAccount } from '../Transactions';

interface TestsCompanyAPI {
  enabled: boolean;
  excelFilesDist?: string;
  invalidPassword?: boolean;
  [key: string]: unknown;
}

interface TestsConfig {
  companyAPI: TestsCompanyAPI;
  credentials: Record<string, unknown>;
  options?: Record<string, unknown>;
  [key: string]: unknown;
}

let testsConfig: TestsConfig | undefined;
let configurationLoaded = false;

const MISSING_ERROR_MESSAGE =
  'Missing test environment configuration. To troubleshoot this issue open CONTRIBUTING.md file and read the "F.A.Q regarding the tests" section.';

export function getTestsConfig(): TestsConfig {
  if (configurationLoaded) {
    if (!testsConfig) {
      throw new Error(MISSING_ERROR_MESSAGE);
    }

    return testsConfig;
  }

  configurationLoaded = true;

  try {
    const environmentConfig = process.env.TESTS_CONFIG;
    if (environmentConfig) {
      testsConfig = JSON.parse(environmentConfig) as TestsConfig;
      return testsConfig;
    }
  } catch (e) {
    throw new Error(
      `failed to parse environment variable 'TESTS_CONFIG' with error '${(e as Error).message}'`,
    );
  }

  try {
    const configPath = path.join(__dirname, '.tests-config.js');
    testsConfig = require(configPath) as TestsConfig;
    return testsConfig;
  } catch (e) {
    console.error(e);
    throw new Error(MISSING_ERROR_MESSAGE);
  }
}

export function maybeTestCompanyAPI(
  scraperId: string,
  filter?: (config: TestsConfig) => boolean | undefined,
): jest.It {
  if (!configurationLoaded) {
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

interface TransactionRow {
  account: string;
  balance: string;
  date: string;
  processedDate: string;
  [key: string]: unknown;
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

  let data: TransactionRow[] = [];

  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];

    data = [
      ...data,
      ...account.txns.map(txn => {
        return {
          account: account.accountNumber,
          balance: `account balance: ${account.balance ?? ''}`,
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
