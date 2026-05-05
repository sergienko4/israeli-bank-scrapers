import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import {
  assertSuccessfulScrape,
  BROWSER_ARGS,
  lastMonthStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';

dotenv.config();

const hasCredentials = !!(process.env.MAX_USERNAME && process.env.MAX_PASSWORD);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

DESCRIBE_IF('E2E: Max (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT * 1.5);
  });

  it(
    'scrapes transactions successfully',
    async () => {
      const scraper = createScraper({
        companyId: CompanyTypes.Max,
        startDate: lastMonthStartDate(),
        shouldShowBrowser: false,
        args: BROWSER_ARGS,
      });
      const username = process.env.MAX_USERNAME ?? '';
      const password = process.env.MAX_PASSWORD ?? '';
      const result = await scraper.scrape({
        username,
        password,
        id: process.env.MAX_ID,
      });

      assertSuccessfulScrape(result);
      logScrapedTransactions(result);
    },
    SCRAPE_TIMEOUT * 1.5,
  );
});
