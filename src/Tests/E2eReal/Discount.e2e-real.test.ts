import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index';
import {
  assertFailedLogin,
  assertSuccessfulScrape,
  BROWSER_ARGS,
  lastMonthStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
  skipIfWafBlocked,
} from './Helpers';

dotenv.config();

const hasCredentials = !!(
  process.env.DISCOUNT_ID &&
  process.env.DISCOUNT_PASSWORD &&
  process.env.DISCOUNT_NUM
);
const describeIf = hasCredentials ? describe : describe.skip;

describeIf('E2E: Discount Bank (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Discount,
      startDate: lastMonthStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      id: process.env.DISCOUNT_ID!,
      password: process.env.DISCOUNT_PASSWORD!,
      num: process.env.DISCOUNT_NUM!,
    });
    if (skipIfWafBlocked(result, 'Discount')) return;
    assertSuccessfulScrape(result);
    logScrapedTransactions(result);
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Discount,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ id: '000000000', password: 'invalid123', num: '000000' });
    assertFailedLogin(result);
  });
});
