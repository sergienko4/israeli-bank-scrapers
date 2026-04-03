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
  process.env.DISCOUNT_ID &&
  process.env.DISCOUNT_PASSWORD &&
  process.env.DISCOUNT_NUM
);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

DESCRIBE_IF('E2E: Discount Bank (real credentials)', () => {
  it('scrapes transactions successfully', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Discount,
      startDate: lastMonthStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      id: process.env.DISCOUNT_ID ?? '',
      password: process.env.DISCOUNT_PASSWORD ?? '',
      num: process.env.DISCOUNT_NUM ?? '',
    });

    assertSuccessfulScrape(result);
    logScrapedTransactions(result);
  }, SCRAPE_TIMEOUT);
});
