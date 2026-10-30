import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import {
  assertSuccessfulScrape,
  lastMonthStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';

dotenv.config();

const hasCredentials = !!(process.env.VISACAL_USERNAME && process.env.VISACAL_PASSWORD);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

DESCRIBE_IF('E2E: VisaCal (real credentials, API-direct)', () => {
  it(
    'scrapes last month over the API and returns a long-term token',
    async () => {
      const startDate = lastMonthStartDate();
      const scraper = createScraper({ companyId: CompanyTypes.VisaCal, startDate });
      const username = process.env.VISACAL_USERNAME ?? '';
      const password = process.env.VISACAL_PASSWORD ?? '';
      const result = await scraper.scrape({ username, password });

      assertSuccessfulScrape(result);
      const token = result.persistentOtpToken ?? '';
      expect(token.length).toBeGreaterThan(0);
      logScrapedTransactions(result);
    },
    SCRAPE_TIMEOUT,
  );
});
