import { jest } from '@jest/globals';

import { createScraper } from '../../index.js';
import { assertFailedLogin, BROWSER_ARGS, SCRAPE_TIMEOUT } from './Helpers.js';
import { SMOKE_BANKS } from './SmokeConfig.js';

beforeAll(() => {
  jest.setTimeout(SCRAPE_TIMEOUT);
});

describe.each(SMOKE_BANKS)(
  'E2E Smoke: $displayName (invalid login)',
  ({ companyId, credentials, defaultTimeout }) => {
    it('rejects invalid credentials', async () => {
      const scraper = createScraper({
        companyId,
        startDate: new Date(),
        shouldShowBrowser: false,
        args: BROWSER_ARGS,
        ...(defaultTimeout ? { defaultTimeout } : {}),
      });
      const result = await scraper.scrape(credentials);
      assertFailedLogin(result);
    });
  },
);
