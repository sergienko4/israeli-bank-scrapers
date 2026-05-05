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

const hasCredentials = !!(
  process.env.MERCANTILE_ID &&
  process.env.MERCANTILE_PASSWORD &&
  process.env.MERCANTILE_NUM
);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

DESCRIBE_IF('E2E: Mercantile (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it(
    'scrapes transactions successfully',
    async () => {
      const scraper = createScraper({
        companyId: CompanyTypes.Mercantile,
        startDate: lastMonthStartDate(),
        shouldShowBrowser: false,
        args: BROWSER_ARGS,
      });
      const result = await scraper.scrape({
        id: process.env.MERCANTILE_ID ?? '',
        password: process.env.MERCANTILE_PASSWORD ?? '',
        num: process.env.MERCANTILE_NUM ?? '',
      });

      assertSuccessfulScrape(result);
      logScrapedTransactions(result);
    },
    SCRAPE_TIMEOUT,
  );
});
