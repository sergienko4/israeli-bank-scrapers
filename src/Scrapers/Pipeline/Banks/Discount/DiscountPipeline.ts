/**
 * Discount bank pipeline configuration.
 * Config only — no scraping logic. Pipeline infrastructure handles fetch + map.
 * New file — does NOT modify DiscountScraper.ts.
 */

import moment from 'moment';

import { CompanyTypes } from '../../../../Definitions.js';
import {
  type ITransaction,
  TransactionStatuses,
  TransactionTypes,
} from '../../../../Transactions.js';
import type { ScraperOptions } from '../../../Base/Interface.js';
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';
import ScraperError from '../../../Base/ScraperError.js';
import { SCRAPER_CONFIGURATION } from '../../../Registry/Config/ScraperConfig.js';
import { createPipelineBuilder } from '../../PipelineBuilder.js';
import type { IPipelineDescriptor } from '../../PipelineDescriptor.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { IRawAccount, IScrapeConfig } from '../../Types/ScrapeConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.Discount];
const DATE_FORMAT = CFG.format.date || 'YYYYMMDD';

/** Scraped transaction from Discount API. */
interface IDiscountTxn {
  OperationNumber: number;
  OperationDate: string;
  ValueDate: string;
  OperationAmount: number;
  OperationDescriptionToDisplay: string;
}

/** Scraped accounts response from /userAccountsData. */
interface IDiscountAccountsRaw {
  UserAccountsData: {
    UserAccounts: { NewAccountInfo: { AccountID: string } }[];
  };
}

/** Scraped transactions response from /lastTransactions. */
interface IDiscountTxnRaw {
  Error?: { MsgText: string };
  CurrentAccountLastTransactions?: {
    OperationEntry: IDiscountTxn[] | null;
    CurrentAccountInfo: { AccountBalance: number };
    FutureTransactionsBlock: {
      FutureTransactionEntry: IDiscountTxn[] | null;
    };
  };
}

/**
 * Map one Discount transaction to ITransaction.
 * @param txn - Raw Discount transaction.
 * @param status - Completed or Pending.
 * @returns Mapped ITransaction.
 */
function mapOneTxn(txn: IDiscountTxn, status: TransactionStatuses): ITransaction {
  return {
    type: TransactionTypes.Normal,
    identifier: txn.OperationNumber,
    date: moment(txn.OperationDate, DATE_FORMAT).toISOString(),
    processedDate: moment(txn.ValueDate, DATE_FORMAT).toISOString(),
    originalAmount: txn.OperationAmount,
    originalCurrency: 'ILS',
    chargedAmount: txn.OperationAmount,
    description: txn.OperationDescriptionToDisplay,
    status,
  };
}

/** Empty transaction list — returned when API has no data block. */
const EMPTY_TXNS: readonly ITransaction[] = [];

/** API base for Discount gateway. */
const API_BASE = `${CFG.api.base}/Titan/gatewayAPI`;

/**
 * Extract account IDs from Discount accounts response.
 * @param raw - Raw API response.
 * @returns Array of raw accounts with IDs.
 */
function mapAccounts(raw: IDiscountAccountsRaw): readonly IRawAccount[] {
  return raw.UserAccountsData.UserAccounts.map(
    (a): IRawAccount => ({
      accountId: a.NewAccountInfo.AccountID,
      balance: 0,
    }),
  );
}

/**
 * Extract transactions from Discount transaction response.
 * @param raw - Raw API response.
 * @returns Array of mapped ITransactions.
 */
function mapTransactions(raw: IDiscountTxnRaw): readonly ITransaction[] {
  if (raw.Error) throw new ScraperError(`Discount API error: ${raw.Error.MsgText}`);
  const block = raw.CurrentAccountLastTransactions;
  if (!block) return EMPTY_TXNS;
  const completed = (block.OperationEntry ?? []).map(
    (t): ITransaction => mapOneTxn(t, TransactionStatuses.Completed),
  );
  const pending = (block.FutureTransactionsBlock.FutureTransactionEntry ?? []).map(
    (t): ITransaction => mapOneTxn(t, TransactionStatuses.Pending),
  );
  return [...completed, ...pending];
}

/**
 * Build start date with Discount's default (1 year + 2 days).
 * @param accountId - The account number.
 * @param startDate - Formatted start date from executor.
 * @returns Request path and empty POST data (GET request).
 */
function buildTxnRequest(
  accountId: string,
  startDate: string,
): { path: string; postData: Record<string, string> } {
  const params = [
    'IsCategoryDescCode=True',
    'IsTransactionDetails=True',
    'IsEventNames=True',
    'IsFutureTransactionFlag=True',
    `FromDate=${startDate}`,
  ].join('&');
  const path = `${API_BASE}/lastTransactions/${accountId}/Date?${params}`;
  const request = { path, postData: {} };
  return request;
}

/** Discount scrape configuration — config only, no logic. */
const DISCOUNT_SCRAPE_CONFIG: IScrapeConfig<IDiscountAccountsRaw, IDiscountTxnRaw> = {
  accounts: {
    method: 'GET',
    path: `${API_BASE}/userAccountsData`,
    postData: {},
    mapper: mapAccounts,
  },
  transactions: {
    method: 'GET',
    buildRequest: buildTxnRequest,
    mapper: mapTransactions,
  },
  pagination: { kind: 'none' },
  dateFormat: DATE_FORMAT,
  defaultCurrency: 'ILS',
  /**
   * Extract balance from transaction response.
   * @param raw - Raw txn API response.
   * @returns Account balance, or 0 if missing.
   */
  balanceExtractor: (raw: IDiscountTxnRaw): number =>
    raw.CurrentAccountLastTransactions?.CurrentAccountInfo.AccountBalance ?? 0,
  /**
   * No extra headers needed — Discount uses session cookies.
   * @returns Empty headers object.
   */
  extraHeaders: (): Record<string, string> => ({}),
};

/** Discount login portal URL. */
const LOGIN_PORTAL = 'https://start.telebank.co.il/login/?multilang=he&bank=d&t=p';

/** Discount login config — defined fresh for the pipeline. */
const DISCOUNT_LOGIN: ILoginConfig = {
  loginUrl: CFG.urls.base || '',
  /** Empty selectors — WellKnown text fallback resolves all fields (black-box architecture). */
  fields: [
    { credentialKey: 'id', selectors: [] },
    { credentialKey: 'password', selectors: [] },
    { credentialKey: 'num', selectors: [] },
  ],
  submit: [
    { kind: 'ariaLabel', value: 'כניסה' },
    { kind: 'textContent', value: 'כניסה' },
  ],
  /**
   * Navigate to Discount login portal and wait for ID field.
   * @param page - The Playwright page instance.
   */
  checkReadiness: async (page): Promise<void> => {
    await page.goto(LOGIN_PORTAL);
    const firstTextbox = page.getByRole('textbox').first();
    await firstTextbox.waitFor({ state: 'visible', timeout: 30000 });
  },
  /**
   * Wait for redirect to Apollo dashboard after login.
   * @param page - The Playwright page instance.
   */
  postAction: async (page): Promise<void> => {
    await page.waitForURL('**/apollo/**', { timeout: 30000 });
  },
  possibleResults: {
    success: [
      'https://start.telebank.co.il/apollo/retail/#/MY_ACCOUNT_HOMEPAGE',
      'https://start.telebank.co.il/apollo/retail2/#/MY_ACCOUNT_HOMEPAGE',
      'https://start.telebank.co.il/apollo/retail2/',
    ],
    invalidPassword: [
      'https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE',
    ],
    changePassword: [
      'https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/PWD_RENEW',
    ],
  },
};

/**
 * Build the Discount pipeline descriptor.
 * @param options - Scraper options from the user.
 * @returns Pipeline descriptor with init → login → scrape → terminate.
 */
function buildDiscountPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return createPipelineBuilder()
    .withOptions(options)
    .withBrowser()
    .withDeclarativeLogin(DISCOUNT_LOGIN)
    .withScrapeConfig(DISCOUNT_SCRAPE_CONFIG)
    .build();
}

export { buildDiscountPipeline, DISCOUNT_LOGIN, DISCOUNT_SCRAPE_CONFIG };
