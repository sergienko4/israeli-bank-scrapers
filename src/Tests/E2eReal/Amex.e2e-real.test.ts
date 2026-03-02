import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index';
import {
  assertFailedLogin,
  assertSuccessfulScrape,
  BROWSER_ARGS,
  lastMonthStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers';

dotenv.config();

const hasCredentials = !!(
  process.env.AMEX_ID &&
  process.env.AMEX_CARD6DIGITS &&
  process.env.AMEX_PASSWORD
);
const describeIf = hasCredentials ? describe : describe.skip;

describeIf('E2E: Amex (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Amex,
      startDate: lastMonthStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      id: process.env.AMEX_ID!,
      card6Digits: process.env.AMEX_CARD6DIGITS!,
      password: process.env.AMEX_PASSWORD!,
    });
    assertSuccessfulScrape(result);
    logScrapedTransactions(result);
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Amex,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      id: '000000000',
      card6Digits: '000000',
      password: 'invalid123',
    });
    assertFailedLogin(result);
  });
});
