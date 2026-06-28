import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import {
  assertSuccessfulScrape,
  BROWSER_ARGS,
  defaultStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';

dotenv.config();

const hasCredentials = !!(
  process.env.YAHAV_USERNAME &&
  process.env.YAHAV_PASSWORD &&
  process.env.YAHAV_ID
);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

DESCRIBE_IF('E2E: Bank Yahav (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Yahav,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      username: process.env.YAHAV_USERNAME ?? '',
      password: process.env.YAHAV_PASSWORD ?? '',
      nationalID: process.env.YAHAV_ID ?? '',
    });

    assertSuccessfulScrape(result);
    logScrapedTransactions(result);
  });
});
