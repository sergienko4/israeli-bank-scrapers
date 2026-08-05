import { createScraper } from '../../index.js';
import { assertFailedLogin, BROWSER_ARGS, SMOKE_TIMEOUT } from './Helpers.js';
import { SMOKE_BANKS } from './SmokeConfig.js';

describe.each(SMOKE_BANKS)(
  'E2E Smoke: $displayName (invalid login)',
  ({ companyId, credentials, defaultTimeout, smokeTimeoutMs }) => {
    // Per-test timeout MUST be the 3rd arg to it(): jest.setTimeout()
    // inside beforeAll runs after describe.each has already registered
    // the tests, so it has no effect on them. Passing the budget here
    // is the only reliable way to hard-cap each smoke test. Banks with a
    // PRE-LOGIN phase spend 211-221s on pre-submit navigation alone and
    // need the wider budget — see SmokeBudget.test.ts, which derives that
    // set from the real pipeline descriptors.
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
      smokeTimeoutMs ?? SMOKE_TIMEOUT,
    );
  },
);
