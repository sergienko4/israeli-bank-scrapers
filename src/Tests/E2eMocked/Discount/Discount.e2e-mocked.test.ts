/**
 * Discount offline invalid-creds mock — uses captured real-bank HTML
 * served via Playwright page.route() to validate that the DOM-
 * login-detection returns a failure (InvalidPassword/Generic) WITHOUT
 * any real network. Fixtures live under C:\tmp\bank-html\discount\
 * (gitignored); the route manifest is fixtures.json alongside them.
 *
 * Rule #17: ZERO NETWORK — OfflineRouteInterceptor records any
 * unmatched outbound request; the test reports escapes after scrape.
 */

import { jest } from '@jest/globals';
import type { Browser, BrowserContext } from 'playwright-core';

import { launchCamoufox } from '../../../Common/CamoufoxLauncher.js';
import { CompanyTypes } from '../../../Definitions.js';
import { createScraper } from '../../../index.js';
import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import { INVALID_CREDS_DISCOUNT } from '../../TestConstants.js';
import { createBankFixtures, type IBankFixtures } from '../Helpers/BankFixtureLoader.js';
import { installOfflineInterceptor } from '../Helpers/OfflineRouteInterceptor.js';

const FIXTURE_ROOT = 'C:/tmp/bank-html/discount';
const TEST_TIMEOUT_MS = 90_000;

/** Credentials deliberately invalid — bytes never travel (zero network). */
const INVALID_CREDS = INVALID_CREDS_DISCOUNT;

describe('offline Discount invalid-creds', () => {
  jest.setTimeout(TEST_TIMEOUT_MS);

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let fixtures: IBankFixtures | undefined;

  beforeAll(async () => {
    fixtures = await createBankFixtures({
      bankKey: 'discount',
      fixtureRoot: FIXTURE_ROOT,
    }).catch((): undefined => undefined);
  });

  afterEach(async () => {
    if (context !== undefined) await context.close().catch((): undefined => undefined);
    if (browser !== undefined) await browser.close().catch((): undefined => undefined);
    context = undefined;
    browser = undefined;
  });

  it('scraper returns success:false when served the captured error HTML', async () => {
    if (fixtures === undefined) {
      throw new ScraperError(
        `fixtures.json missing — run "npm run capture:invalid-login -- discount" or an E2E with DUMP_FIXTURES_DIR set to populate ${FIXTURE_ROOT}.`,
      );
    }
    browser = await launchCamoufox(true);
    context = await browser.newContext();
    const page = await context.newPage();
    const interceptor = await installOfflineInterceptor({ page, fixtures });
    const scraper = createScraper({
      companyId: CompanyTypes.Discount,
      startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      browserContext: context,
      skipCloseBrowser: true,
    } as never);
    const result = await scraper.scrape(INVALID_CREDS);
    expect(result.success).toBe(false);
    expect(interceptor.escapes).toHaveLength(0);
    await interceptor.dispose();
  });
});
