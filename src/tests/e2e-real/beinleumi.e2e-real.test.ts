import * as dotenv from 'dotenv';
import { createScraper, CompanyTypes } from '../../index';
import { SCRAPE_TIMEOUT, BROWSER_ARGS, assertSuccessfulScrape, assertFailedLogin, lastMonthStartDate } from './helpers';

dotenv.config();

const hasCredentials = !!(process.env.BEINLEUMI_USERNAME && process.env.BEINLEUMI_PASSWORD);
const describeIf = hasCredentials ? describe : describe.skip;

describeIf('E2E: Beinleumi (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.beinleumi,
      startDate: lastMonthStartDate(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      username: process.env.BEINLEUMI_USERNAME!,
      password: process.env.BEINLEUMI_PASSWORD!,
    });
    assertSuccessfulScrape(result);
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.beinleumi,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ username: 'INVALID_USER', password: 'invalid123' });
    assertFailedLogin(result);
  });
});
