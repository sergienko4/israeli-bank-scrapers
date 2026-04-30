import { createScraper } from '../../index.js';
import { assertFailedLogin, BROWSER_ARGS, SMOKE_TIMEOUT } from './Helpers.js';
import { SMOKE_BANKS } from './SmokeConfig.js';

describe.each(SMOKE_BANKS)(
  'E2E Smoke: $displayName (invalid login)',
  ({ companyId, credentials, defaultTimeout }) => {
    // Per-test timeout MUST be the 3rd arg to it(): jest.setTimeout()
    // inside beforeAll runs after describe.each has already registered
    // the tests, so it has no effect on them. Passing SMOKE_TIMEOUT here
    // is the only reliable way to hard-cap each smoke test at 90s.
    it(
      'rejects invalid credentials',
      async () => {
        const scraper = createScraper({
          companyId,
          startDate: new Date(),
          shouldShowBrowser: false,
          args: BROWSER_ARGS,
          ...(defaultTimeout ? { defaultTimeout } : {}),
        });
        const result = await scraper.scrape(credentials);
        assertFailedLogin(result);
      },
      SMOKE_TIMEOUT,
    );
  },
);
