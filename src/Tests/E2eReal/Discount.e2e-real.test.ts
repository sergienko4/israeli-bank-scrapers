import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import { INVALID_CREDS_DISCOUNT } from '../TestConstants.js';
import {
  assertFailedLogin,
  assertSuccessfulScrape,
  BROWSER_ARGS,
  defaultStartDate,
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
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Discount,
      startDate: defaultStartDate(),
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
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Discount,
      startDate: defaultStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape(INVALID_CREDS_DISCOUNT);
    assertFailedLogin(result);
  });
});
