import * as dotenv from 'dotenv';
import { createScraper, CompanyTypes } from '../../index';
import {
  SCRAPE_TIMEOUT,
  BROWSER_ARGS,
  assertSuccessfulScrape,
  assertFailedLogin,
  lastMonthStartDate,
} from './Helpers';

dotenv.config();

const hasCredentials = !!(process.env.MAX_USERNAME && process.env.MAX_PASSWORD);
const describeIf = hasCredentials ? describe : describe.skip;

describeIf('E2E: Max (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Max,
      startDate: lastMonthStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      username: process.env.MAX_USERNAME!,
      password: process.env.MAX_PASSWORD!,
    });
    assertSuccessfulScrape(result);
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Max,
      startDate: new Date(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});
