import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import {
  assertSuccessfulScrape,
  lastMonthStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';

dotenv.config();

const hasCredentials = !!(
  process.env.AMEX_ID &&
  process.env.AMEX_CARD6DIGITS &&
  process.env.AMEX_PASSWORD
);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

DESCRIBE_IF('E2E: Amex (real credentials, API-direct)', () => {
  it(
    'scrapes last month over the API and returns a device key',
    async () => {
      const startDate = lastMonthStartDate();
      const scraper = createScraper({ companyId: CompanyTypes.Amex, startDate });
      const id = process.env.AMEX_ID ?? '';
      const card6Digits = process.env.AMEX_CARD6DIGITS ?? '';
      const password = process.env.AMEX_PASSWORD ?? '';
      const result = await scraper.scrape({ id, card6Digits, password });

      assertSuccessfulScrape(result);
      const key = result.persistentOtpToken ?? '';
      expect(key.length).toBeGreaterThan(0);
      logScrapedTransactions(result);
    },
    SCRAPE_TIMEOUT,
  );
});
