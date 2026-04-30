/**
 * OneZero — mocked E2E (Headless Strategy).
 *
 * Rule #17: mock suite parity — this is the 8th bank fixture.
 * Rule #18: all credentials + data synthetic; no real PII.
 *
 * The test installs a synthetic globalThis.fetch, drives createScraper()
 * through its full login + scrape lifecycle, and asserts the pipeline
 * returns one account with the expected synthetic transactions and balance.
 *
 * The fetch mock short-circuits the OTP flow via `otpLongTermToken`, so the
 * scraper exercises: getIdToken → sessions/token → GetCustomer →
 * GetMovements (paginated) → GetAccountBalance.
 */

import { CompanyTypes } from '../../../Definitions.js';
import { createScraper } from '../../../index.js';
import { installOneZeroFetchMock, ONEZERO_MOCK_CREDS } from './OneZeroFetchMock.js';

/** Start window for the scrape — well before the synthetic movements. */
const SCRAPE_START_DATE = new Date('2026-01-01');

/** Expected portfolio number from the synthetic GetCustomer response. */
const EXPECTED_PORTFOLIO_NUM = '40286139';

/** Expected synthetic current-account balance. */
const EXPECTED_BALANCE = 2850.6;

/** Minimum number of transactions the two-page synthetic response produces. */
const MIN_EXPECTED_TXNS = 2;

/** Minimum identity POSTs: getIdToken + sessions/token. */
const MIN_IDENTITY_CALLS = 2;

/** Minimum GraphQL calls: customer + movements + balance (plus pagination). */
const MIN_GRAPHQL_CALLS = 3;

describe('OneZero — mocked E2E (Headless Strategy)', () => {
  it('completes login + scrape and returns synthetic accounts', async () => {
    const mock = installOneZeroFetchMock();
    try {
      const scraper = createScraper({
        companyId: CompanyTypes.OneZero,
        startDate: SCRAPE_START_DATE,
      });
      const result = await scraper.scrape({ ...ONEZERO_MOCK_CREDS });

      expect(result.success).toBe(true);
      if (result.success) {
        const accounts = result.accounts ?? [];
        expect(accounts).toHaveLength(1);
        expect(accounts[0].accountNumber).toBe(EXPECTED_PORTFOLIO_NUM);
        expect(accounts[0].balance).toBe(EXPECTED_BALANCE);

        const txnCount = accounts[0].txns.length;
        expect(txnCount).toBeGreaterThanOrEqual(MIN_EXPECTED_TXNS);

        const counts = mock.callCounts();
        expect(counts.identity).toBeGreaterThanOrEqual(MIN_IDENTITY_CALLS);
        expect(counts.graphql).toBeGreaterThanOrEqual(MIN_GRAPHQL_CALLS);
      }
    } finally {
      mock.dispose();
    }
  }, 60000);
});
