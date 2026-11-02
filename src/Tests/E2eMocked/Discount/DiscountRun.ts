/**
 * Discount mocked-run helpers — scrape against the synthetic bank and slice
 * the call log the way the mocked E2E suites assert it.
 *
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { CompanyTypes } from '../../../Definitions.js';
import type {
  IScraperScrapingResult,
  ScraperCredentials,
} from '../../../Scrapers/Base/Interface.js';
import createScraper from '../../../Scrapers/Registry/Factory.js';
import { getLaunchCount } from '../../Mocks/CamoufoxJsMock.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import type { DiscountFault } from './DiscountFaults.js';
import { classifyDiscount, installDiscountFetchMock } from './DiscountFetchMock.js';
import {
  DC_FROM_DATE,
  DISCOUNT_MOCK_ACCOUNTS,
  DISCOUNT_MOCK_CREDS,
  DISCOUNT_MOCK_START_DATE,
} from './DiscountMockData.js';

/** What one mocked run produced. */
export interface IDiscountRun {
  readonly result: IScraperScrapingResult;
  readonly calls: readonly IRecordedCall[];
  /** `<METHOD> <path><query>` of each call, in order. */
  readonly trail: readonly string[];
  /** Every Titan read. */
  readonly data: readonly IRecordedCall[];
  readonly launches: number;
}

/** The login trail up to and including the sealed login. */
export const LOGIN_TRAIL = [
  'GET /login/',
  'POST /Lobby/gatewayAPI/verification/getInfo',
  'POST /Lobby/gatewayAPI/login',
];

/** Login's one redirect hop, to its outcome. */
export const SUCCESS_HOP = 'GET /Lobby/gatewayAPI/loginSuccessResponse';

/** The success hop, then the landing and its one hop. */
export const HANDOFF_TRAIL = [SUCCESS_HOP, 'GET /apollo/retail3', 'GET /apollo/retail3/'];

/** The accounts read. */
export const ACCOUNTS_TRAIL = [
  'GET /Titan/gatewayAPI/userAccountsData?FetchAccountsNickName=true&FirstTimeEntry=true',
];

/** The query every transactions read sends. */
const TXN_QUERY = `IsCategoryDescCode=True&IsTransactionDetails=True&IsEventNames=True&IsFutureTransactionFlag=True&FromDate=${DC_FROM_DATE}`;

/**
 * One account's reads: its balance, then its rows.
 * @param id - The account's Titan id.
 * @returns The two trail entries.
 */
export function accountTrailOf(id: string): readonly string[] {
  return [
    `GET /Titan/gatewayAPI/accountDetails/infoAndBalance/${id}`,
    `GET /Titan/gatewayAPI/lastTransactions/transactions/${id}/Date?${TXN_QUERY}`,
  ];
}

/** The whole cold trail: login, handoff, accounts, then each account's reads. */
export const COLD_TRAIL: readonly string[] = [
  ...LOGIN_TRAIL,
  ...HANDOFF_TRAIL,
  ...ACCOUNTS_TRAIL,
  ...DISCOUNT_MOCK_ACCOUNTS.flatMap(account => accountTrailOf(account.id)),
];

/**
 * A call's trail entry.
 * @param call - A recorded call.
 * @returns `<METHOD> <path><query>`.
 */
export function trailOf(call: IRecordedCall): string {
  const { pathname, search } = new URL(call.url);
  return `${call.method} ${pathname}${search}`;
}

/**
 * Whether a call was a Titan read.
 * @param call - A recorded call.
 * @returns True for the accounts, balance and transactions reads.
 */
function isDataCall(call: IRecordedCall): boolean {
  return classifyDiscount(call) === 'graphql';
}

/**
 * Scrape Discount against the synthetic bank.
 * @param fault - Fault the bank answers with.
 * @param creds - Credentials to scrape with.
 * @returns The result, the call log and how many browsers were launched.
 */
export async function runDiscount(
  fault: DiscountFault = 'none',
  creds: ScraperCredentials = { ...DISCOUNT_MOCK_CREDS },
): Promise<IDiscountRun> {
  const launchesBefore = getLaunchCount();
  const handle = installDiscountFetchMock(fault);
  try {
    const options = { companyId: CompanyTypes.Discount, startDate: DISCOUNT_MOCK_START_DATE };
    const scraper = createScraper(options);
    const result = await scraper.scrape(creds);
    const launches = getLaunchCount() - launchesBefore;
    const calls = handle.calls();
    return { result, calls, trail: calls.map(trailOf), data: calls.filter(isDataCall), launches };
  } finally {
    handle.dispose();
  }
}
