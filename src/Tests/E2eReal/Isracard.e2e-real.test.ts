import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import {
  assertFailedLogin,
  assertSuccessfulScrape,
  BROWSER_ARGS,
  lastMonthStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';

dotenv.config();

const hasCredentials = !!(
  process.env.ISRACARD_ID &&
  process.env.ISRACARD_CARD6DIGITS &&
  process.env.ISRACARD_PASSWORD
);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

DESCRIBE_IF('E2E: Isracard (real credentials)', () => {
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
    const isracardId = process.env.ISRACARD_ID ?? '';
    const isracardCard = process.env.ISRACARD_CARD6DIGITS ?? '';
    const isracardPassword = process.env.ISRACARD_PASSWORD ?? '';
    const result = await scraper.scrape({
      id: isracardId,
      card6Digits: isracardCard,
      password: isracardPassword,
    });

    assertSuccessfulScrape(result);
    logScrapedTransactions(result);
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
