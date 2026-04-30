/**
 * Pepper E2eMocked test — offline pipeline run backed by synthetic fetch.
 * Rule #18: zero real PII.
 */

import { CompanyTypes } from '../../../Definitions.js';
import createScraper from '../../../Scrapers/Registry/Factory.js';
import { installPepperFetchMock, PEPPER_MOCK_CREDS } from './PepperFetchMock.js';

const NINETY_DAYS_AGO = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

/**
 * Fake OTP retriever — mock mode never sends a real SMS.
 * @returns Placeholder code.
 */
function fakeOtpRetriever(): Promise<string> {
  return Promise.resolve('fixt-otp-pep-7c1a');
}

describe('Pepper mocked E2E', () => {
  it('scrapes one account + per-page transactions via synthetic fetch', async () => {
    const handle = installPepperFetchMock();
    try {
      const scraper = createScraper({
        companyId: CompanyTypes.Pepper,
        startDate: NINETY_DAYS_AGO,
        otpCodeRetriever: fakeOtpRetriever,
      });
      const result = await scraper.scrape({ ...PEPPER_MOCK_CREDS });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.accounts ?? []).toHaveLength(1);
      }
      const counts = handle.callCounts();
      expect(counts.graphql).toBeGreaterThanOrEqual(3);
    } finally {
      handle.dispose();
    }
  });
});
