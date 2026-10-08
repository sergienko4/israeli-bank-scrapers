import { jest } from '@jest/globals';
import * as dotenv from 'dotenv';

import { CompanyTypes, createScraper } from '../../index.js';
import {
  assertSuccessfulScrape,
  BROWSER_ARGS,
  logScrapedTransactions,
  SCRAPE_TIMEOUT,
} from './Helpers.js';
import { type IDaysBackOverride, overridableStartDate } from './WindowOverride.js';

dotenv.config();

const hasCredentials = !!(process.env.MIZRAHI_USERNAME && process.env.MIZRAHI_PASSWORD);
const DESCRIBE_IF = hasCredentials ? describe : describe.skip;

/**
 * Window override: `MIZRAHI_E2E_DAYS_BACK`, 1 to 365 days (180 when unset).
 * The server serves 365 days back (real logins #9 and #13), so a longer
 * window could only prove the shape's clamp.
 */
const MIZRAHI_WINDOW: IDaysBackOverride = { envName: 'MIZRAHI_E2E_DAYS_BACK', maxDays: 365 };

DESCRIBE_IF('E2E: Bank Mizrahi (real credentials)', () => {
  beforeAll(() => {
    jest.setTimeout(SCRAPE_TIMEOUT);
  });

  it('scrapes transactions successfully', async () => {
    const options = {
      companyId: CompanyTypes.Mizrahi,
      startDate: overridableStartDate(MIZRAHI_WINDOW),
      shouldShowBrowser: false,
      args: BROWSER_ARGS,
    };
    console.log(`Mizrahi E2E window starts ${options.startDate.toISOString()}`);
    const scraper = createScraper(options);
    const result = await scraper.scrape({
      username: process.env.MIZRAHI_USERNAME ?? '',
      password: process.env.MIZRAHI_PASSWORD ?? '',
    });

    assertSuccessfulScrape(result);
    logScrapedTransactions(result);
  });
});
