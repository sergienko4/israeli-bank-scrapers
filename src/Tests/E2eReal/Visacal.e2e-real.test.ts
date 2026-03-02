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

const hasCredentials = !!(process.env.VISACAL_USERNAME && process.env.VISACAL_PASSWORD);
const describeIf = hasCredentials ? describe : describe.skip;

describeIf('E2E: VisaCal (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.VisaCal,
      startDate: lastMonthStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      username: process.env.VISACAL_USERNAME!,
      password: process.env.VISACAL_PASSWORD!,
    });
    if (skipIfWafBlocked(result, 'VisaCal')) return;
    assertSuccessfulScrape(result);
    logScrapedTransactions(result);
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.VisaCal,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER_XYZ', password: 'invalid123' });
    assertFailedLogin(result);
  });
});
