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
  process.env.ISRACARD_ID &&
  process.env.ISRACARD_CARD6DIGITS &&
  process.env.ISRACARD_PASSWORD
);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

DESCRIBE_IF('E2E: Isracard (real credentials, API-direct)', () => {
  it(
    'scrapes last month over the API and returns a device key',
    async () => {
      const startDate = lastMonthStartDate();
      const scraper = createScraper({ companyId: CompanyTypes.Isracard, startDate });
      const id = process.env.ISRACARD_ID ?? '';
      const card6Digits = process.env.ISRACARD_CARD6DIGITS ?? '';
      const password = process.env.ISRACARD_PASSWORD ?? '';
      const result = await scraper.scrape({ id, card6Digits, password });

      assertSuccessfulScrape(result);
      const key = result.persistentOtpToken ?? '';
      expect(key.length).toBeGreaterThan(0);
      logScrapedTransactions(result);
    },
    SCRAPE_TIMEOUT,
  );
});
