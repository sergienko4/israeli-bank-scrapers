import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index';
import {
  assertFailedLogin,
  assertSuccessfulScrape,
  BROWSER_ARGS,
  lastMonthStartDate,
  SCRAPE_TIMEOUT,
} from './Helpers';

dotenv.config();

const hasCredentials = !!(
  process.env.ISRACARD_ID &&
  process.env.ISRACARD_CARD6DIGITS &&
  process.env.ISRACARD_PASSWORD
);
const describeIf = hasCredentials ? describe : describe.skip;

describeIf('E2E: Isracard (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Isracard,
      startDate: lastMonthStartDate(),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    });
    const result = await scraper.scrape({
      id: process.env.ISRACARD_ID!,
      card6Digits: process.env.ISRACARD_CARD6DIGITS!,
      password: process.env.ISRACARD_PASSWORD!,
    });
    assertSuccessfulScrape(result);
  });

  it('fails with invalid credentials', async () => {
    const scraper = createScraper({
      companyId: CompanyTypes.Isracard,
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
