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
  process.env.DISCOUNT_ID &&
  process.env.DISCOUNT_PASSWORD &&
  process.env.DISCOUNT_NUM
);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

DESCRIBE_IF('E2E: Discount Bank (real credentials, API-direct)', () => {
  it(
    'scrapes transactions successfully',
    async () => {
      const scraper = createScraper({
        companyId: CompanyTypes.Discount,
        startDate: lastMonthStartDate(),
      });
      const result = await scraper.scrape({
        id: process.env.DISCOUNT_ID ?? '',
        password: process.env.DISCOUNT_PASSWORD ?? '',
        num: process.env.DISCOUNT_NUM ?? '',
      });

      assertSuccessfulScrape(result);
      logScrapedTransactions(result);
    },
    SCRAPE_TIMEOUT,
  );
});
