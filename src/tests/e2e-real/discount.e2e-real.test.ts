import * as dotenv from 'dotenv';
import { createScraper, CompanyTypes } from '../../index';
import { SCRAPE_TIMEOUT, BROWSER_ARGS, assertSuccessfulScrape, assertFailedLogin, lastMonthStartDate } from './helpers';

dotenv.config();

const hasCredentials = !!(process.env.DISCOUNT_ID && process.env.DISCOUNT_PASSWORD && process.env.DISCOUNT_NUM);
const describeIf = hasCredentials ? describe : describe.skip;

describeIf('E2E: Discount Bank (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.discount,
      startDate: lastMonthStartDate(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      id: process.env.DISCOUNT_ID!,
      password: process.env.DISCOUNT_PASSWORD!,
      num: process.env.DISCOUNT_NUM!,
    });
    assertSuccessfulScrape(result);
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.discount,
      startDate: new Date(),
      showBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({ id: '000000000', password: 'invalid123', num: '000000' });
    assertFailedLogin(result);
  });
});
