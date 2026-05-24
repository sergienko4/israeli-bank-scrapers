/**
 * Unified API-DIRECT E2E mock — exercises the offline pipeline flow shared
 * by every API-DIRECT bank (Pepper, OneZero, ...) through one parameterized
 * spec backed by the per-bank synthetic fetch mocks.
 *
 * Rule #17: mock suite parity stays intact — every bank case in this file
 * preserves the exact assertion coverage of the per-bank file it replaces.
 * Rule #18: all credentials + data are synthetic; no real PII.
 */

import { CompanyTypes } from '../../../Definitions.js';
import type { ScraperCredentials } from '../../../Scrapers/Base/Interface.js';
import createScraper from '../../../Scrapers/Registry/Factory.js';
import { installOneZeroFetchMock, ONEZERO_MOCK_CREDS } from '../OneZero/OneZeroFetchMock.js';
import type { IMockHandle as IPepperMockHandle } from '../Pepper/PepperFetchMock.js';
import { installPepperFetchMock, PEPPER_MOCK_CREDS } from '../Pepper/PepperFetchMock.js';

/** Lookback window matching the original Pepper spec. */
const PEPPER_START_DATE = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

/** Fixed window matching the original OneZero spec. */
const ONEZERO_START_DATE = new Date('2026-01-01');

/** Synthetic OTP code returned by the Pepper fake retriever. */
const PEPPER_FAKE_OTP = 'fixt-otp-pep-7c1a';

/** Shared mock-handle shape — both per-bank mocks expose this contract. */
type MockHandle = IPepperMockHandle;

/** Minimal account shape consumed by the parameterized assertions. */
interface IAccountSlice {
  readonly accountNumber: string;
  readonly balance?: number;
  readonly txns: readonly unknown[];
}

/**
 * One parameterized flow case — maps a bank onto the inputs and thresholds
 * that drive the shared API-DIRECT scrape assertions.
 */
interface IApiDirectFlowCase {
  readonly displayName: string;
  readonly companyId: CompanyTypes;
  readonly installFetchMock: () => MockHandle;
  readonly mockCreds: ScraperCredentials;
  readonly otpCodeRetriever?: (phoneHint: string) => Promise<string>;
  readonly startDate: Date;
  readonly expectedAccounts: number;
  readonly expectedAccountNumber?: string;
  readonly expectedBalance?: number;
  readonly minTxns?: number;
  readonly minGraphqlCalls: number;
  readonly minIdentityCalls?: number;
  readonly timeoutMs?: number;
}

/**
 * Fake OTP retriever — mock mode never sends a real SMS.
 * @returns Placeholder code consumed by the Pepper login pipeline.
 */
function fakeOtpRetriever(): Promise<string> {
  return Promise.resolve(PEPPER_FAKE_OTP);
}

const PEPPER_CASE: IApiDirectFlowCase = {
  displayName: 'Pepper',
  companyId: CompanyTypes.Pepper,
  installFetchMock: installPepperFetchMock,
  mockCreds: { ...PEPPER_MOCK_CREDS },
  otpCodeRetriever: fakeOtpRetriever,
  startDate: PEPPER_START_DATE,
  expectedAccounts: 1,
  // FINDING-9 (8b RabbitAI review) — restore txn-shape assertion the
  // unified spec dropped relative to the original Pepper E2eMocked test.
  // PepperFetchMock returns 1 posted + 1 pending row per page, so the
  // canonical scrape result must surface at least one txn per account.
  minTxns: 1,
  minGraphqlCalls: 3,
};

const ONEZERO_CASE: IApiDirectFlowCase = {
  displayName: 'OneZero',
  companyId: CompanyTypes.OneZero,
  installFetchMock: installOneZeroFetchMock,
  mockCreds: { ...ONEZERO_MOCK_CREDS },
  startDate: ONEZERO_START_DATE,
  expectedAccounts: 1,
  expectedAccountNumber: '40286139',
  expectedBalance: 2850.6,
  minTxns: 2,
  minGraphqlCalls: 3,
  minIdentityCalls: 2,
  timeoutMs: 60000,
};

const CASES: readonly IApiDirectFlowCase[] = [PEPPER_CASE, ONEZERO_CASE];

/** Minimal scraper-options shape exercised by this parameterized spec. */
interface IApiDirectScraperOptions {
  readonly companyId: CompanyTypes;
  readonly startDate: Date;
  readonly otpCodeRetriever?: (phoneHint: string) => Promise<string>;
}

/**
 * Builds the scraper-options shape, omitting the OTP retriever when the
 * bank's flow does not require one. Kept tiny so the test body stays flat.
 * @param testCase parameterized bank case being executed.
 * @returns Options literal accepted by {@link createScraper}.
 */
function buildScraperOptions(testCase: IApiDirectFlowCase): IApiDirectScraperOptions {
  const base: IApiDirectScraperOptions = {
    companyId: testCase.companyId,
    startDate: testCase.startDate,
  };
  return testCase.otpCodeRetriever
    ? { ...base, otpCodeRetriever: testCase.otpCodeRetriever }
    : base;
}

/**
 * Asserts the per-bank account-shape thresholds carried by the case.
 * Skipping a threshold is encoded as `undefined` on the case object.
 * @param account first scraped account under assertion.
 * @param testCase parameterized bank case providing the thresholds.
 * @returns `true` once every encoded threshold has been verified.
 */
function assertAccountShape(account: IAccountSlice, testCase: IApiDirectFlowCase): boolean {
  if (testCase.expectedAccountNumber !== undefined) {
    expect(account.accountNumber).toBe(testCase.expectedAccountNumber);
  }
  if (testCase.expectedBalance !== undefined) {
    expect(account.balance).toBe(testCase.expectedBalance);
  }
  if (testCase.minTxns !== undefined) {
    expect(account.txns.length).toBeGreaterThanOrEqual(testCase.minTxns);
  }
  return true;
}

/**
 * Asserts the per-bank API-call lower bounds captured by the fetch mock.
 * @param handle mock handle exposing the call counters.
 * @param testCase parameterized bank case providing the minimums.
 * @returns `true` once every counter threshold has been verified.
 */
function assertCallCounts(handle: MockHandle, testCase: IApiDirectFlowCase): boolean {
  const counts = handle.callCounts();
  expect(counts.graphql).toBeGreaterThanOrEqual(testCase.minGraphqlCalls);
  if (testCase.minIdentityCalls !== undefined) {
    expect(counts.identity).toBeGreaterThanOrEqual(testCase.minIdentityCalls);
  }
  return true;
}

describe.each(CASES)('API-DIRECT mocked E2E — $displayName', testCase => {
  it(
    'completes login + scrape and returns synthetic accounts',
    async () => {
      const handle = testCase.installFetchMock();
      try {
        const scraperOptions = buildScraperOptions(testCase);
        const scraper = createScraper(scraperOptions);
        const result = await scraper.scrape({ ...testCase.mockCreds });
        expect(result.success).toBe(true);
        if (result.success) {
          const accounts = (result.accounts ?? []) as IAccountSlice[];
          expect(accounts).toHaveLength(testCase.expectedAccounts);
          assertAccountShape(accounts[0], testCase);
          assertCallCounts(handle, testCase);
        }
      } finally {
        handle.dispose();
      }
    },
    testCase.timeoutMs,
  );
});
