import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import {
  assertSuccessfulScrape,
  BROWSER_ARGS,
  lastMonthStartDate,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';

dotenv.config();

const hasCredentials = !!(
  process.env.AMEX_ID &&
  process.env.AMEX_CARD6DIGITS &&
  process.env.AMEX_PASSWORD
);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

DESCRIBE_IF('E2E: Amex (real credentials)', () => {
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
    const amexId = process.env.AMEX_ID ?? '';
    const amexCard = process.env.AMEX_CARD6DIGITS ?? '';
    const amexPassword = process.env.AMEX_PASSWORD ?? '';
    const result = await scraper.scrape({
      id: amexId,
      card6Digits: amexCard,
      password: amexPassword,
    });

    assertSuccessfulScrape(result);
    logScrapedTransactions(result);
  });
});
