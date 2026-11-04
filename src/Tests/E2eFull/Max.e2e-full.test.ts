import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import {
  assertSuccessfulScrape,
  lastMonthStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';

dotenv.config();

const hasCredentials = !!(process.env.MAX_USERNAME && process.env.MAX_PASSWORD);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

DESCRIBE_IF('E2E: Max (real credentials, API-direct)', () => {
  it(
    'scrapes last month over the API',
    async () => {
      const startDate = lastMonthStartDate();
      const scraper = createScraper({ companyId: CompanyTypes.Max, startDate });
      const username = process.env.MAX_USERNAME ?? '';
      const password = process.env.MAX_PASSWORD ?? '';
      const result = await scraper.scrape({ username, password });

      assertSuccessfulScrape(result);
      logScrapedTransactions(result);
    },
    SCRAPE_TIMEOUT,
  );
});
