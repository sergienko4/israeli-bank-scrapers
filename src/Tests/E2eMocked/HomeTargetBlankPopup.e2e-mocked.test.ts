/**
 * HOME phase target="_blank" popup-follow — Mock-E2E integration test.
 *
 * Per test-guidelines.md ("integration test over unit test. unitest for
 * edge cases only") + the Testing Diamond drawing in the master plan
 * (`pipeline-decoupling-master/phase-2/test.txt`), this test exercises
 * the COMPLETE HOME PRE → ACTION path through real production code
 * (`resolveHomeStrategy` + `executeHomeNavigation`) against a real
 * Camoufox browser served fixture HTML that reproduces the failure
 * shape from Isracard E2E Real A 2026-06-03 diag artefact 7376928279:
 *
 *   <a aria-label="כניסה לחשבון שלי"
 *      href="https://digital.isracard.co.il/personalarea/Login/"
 *      target="_blank" rel="noopener">החשבון שלי</a>
 *
 * The unit-test-only "HomeResolverPopupOverride.test.ts" and
 * "HomeActionsPopupNavigate.test.ts" that were drafted alongside the
 * production fix could not catch the bug because they test
 * implementation details against mock mediators that do not simulate
 * Playwright's real popup semantics. This Mock-E2E test would have
 * surfaced the original regression in CI (no real credentials needed).
 */

import pino from 'pino';
import { type Browser, type BrowserContext, type Page } from 'playwright-core';

import ScraperError from '../../Scrapers/Base/ScraperError.js';
import {
  createElementMediator,
  extractActionMediator,
} from '../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import { executeHomeNavigation } from '../../Scrapers/Pipeline/Mediator/Home/HomeActions.Navigate.js';
import { resolveHomeStrategy } from '../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { isOk } from '../../Scrapers/Pipeline/Types/Procedure.js';
import { closeSharedBrowser, getSharedBrowser } from './Helpers/BrowserFixture.js';
import { loadFixture, setupRequestInterception } from './Helpers/RequestInterceptor.js';

const MARKETING_URL = 'https://www.example-bank.local/';
const POPUP_LOGIN_URL = 'https://digital.example-bank.local/personalarea/Login/';
const BROWSER_BOOT_TIMEOUT_MS = 30000;
const TEST_TIMEOUT_MS = 90000;

let browser: Browser;

beforeAll(async () => {
  browser = await getSharedBrowser();
}, BROWSER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await closeSharedBrowser();
});

/**
 * Build a silent pino logger suitable for production code that does
 * not need log inspection.
 * @returns Silent pino logger.
 */
function silentLogger(): pino.Logger {
  return pino({ enabled: false });
}

/**
 * Provision a fresh context+page wired to the marketing + login
 * fixture pages. The marketing page contains the
 * `<a target="_blank">` login trigger that reproduces the Isracard
 * Real A failure.
 * @returns Fresh context + page (caller must close the context).
 */
async function preparePage(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await setupRequestInterception(page, [
    {
      match: '/personalarea/Login',
      contentType: 'text/html',
      body: loadFixture('home-target-blank/login-page.html'),
    },
    {
      match: 'example-bank.local',
      contentType: 'text/html',
      body: loadFixture('home-target-blank/marketing-page.html'),
    },
    {
      match: /.*/,
      abort: true,
    },
  ]);
  await page.goto(MARKETING_URL, { waitUntil: 'domcontentloaded' });
  return { context, page };
}

/**
 * Drive the real HOME PRE→ACTION code path against the provided page.
 * Returns the discovery + didNavigate flag so each test asserts on
 * the user-observable outcomes.
 * @param page - Live Playwright page (post-marketing-goto).
 * @returns Discovery + didNavigate flag from the real production code.
 */
async function runHomePreAndAction(
  page: Page,
): Promise<{ navHrefOverride: string; didNavigate: boolean }> {
  const logger = silentLogger();
  const mediator = createElementMediator(page);
  const discoveryResult = await resolveHomeStrategy(mediator, logger, page);
  if (!isOk(discoveryResult)) {
    throw new ScraperError('HOME PRE failed in target-blank popup-follow test');
  }
  const override = discoveryResult.value.navHrefOverride;
  if (!override) {
    throw new ScraperError('HOME PRE did not capture navHrefOverride');
  }
  const executor = extractActionMediator(mediator, page);
  const didNavigate = await executeHomeNavigation(executor, discoveryResult.value, logger);
  return { navHrefOverride: override, didNavigate };
}

describe('HOME phase — target="_blank" popup-follow (Isracard E2E Real A regression)', () => {
  it(
    'PRE captures navHrefOverride, ACTION navigates the bound page to the login URL, and the password field is reachable',
    async () => {
      const { context, page } = await preparePage();
      try {
        const outcome = await runHomePreAndAction(page);
        expect(outcome.navHrefOverride).toBe(POPUP_LOGIN_URL);
        expect(outcome.didNavigate).toBe(true);
        const finalUrl = page.url();
        expect(finalUrl).toContain('/personalarea/Login/');
        const passwordLocator = page.locator('input[type="password"]');
        const passwordCount = await passwordLocator.count();
        expect(passwordCount).toBeGreaterThan(0);
      } finally {
        await context.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
