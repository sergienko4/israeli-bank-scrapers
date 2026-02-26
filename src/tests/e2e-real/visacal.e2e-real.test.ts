import * as dotenv from 'dotenv';
import { createScraper, CompanyTypes } from '../../index';
import { SCRAPE_TIMEOUT, BROWSER_ARGS, assertSuccessfulScrape, assertFailedLogin, lastMonthStartDate } from './helpers';

dotenv.config();

const hasCredentials = !!(process.env.VISACAL_USERNAME && process.env.VISACAL_PASSWORD);
const describeIf = hasCredentials ? describe : describe.skip;

describeIf('E2E: VisaCal (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.visaCal,
      startDate: lastMonthStartDate(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      username: process.env.VISACAL_USERNAME!,
      password: process.env.VISACAL_PASSWORD!,
    });
    assertSuccessfulScrape(result);
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.visaCal,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER_XYZ', password: 'invalid123' });
    assertFailedLogin(result);
  });
});
