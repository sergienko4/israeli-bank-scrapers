/**
 * HOME trigger resolution — visible/hidden same-text twin. LATENT bug in the
 * SHARED home resolver, exposed by Bank Leumi's home shape. Mock-E2E test.
 *
 * Faithful reproduction of the real Bank Leumi home shape the user reported.
 * TWO controls share the identical visible text AND aria-label "כניסה לחשבון":
 *   1. Node A (DOM-FIRST) — an OFF-CANVAS link inside a collapsed search/help
 *      panel, shifted off-screen (position:absolute; left:-10000px). It keeps
 *      a real bounding box, so Playwright reports it "visible", but a human
 *      never sees or reaches it and it FAILS the elementFromPoint hit-test.
 *      Real Leumi gives it href="#" (a JS search term that surfaces a "how to
 *      log in" help article); modelled here as a real /help URL so the
 *      wrong-pick is OBSERVABLE via the final URL. It has NO login form.
 *   2. Node B (DOM-SECOND) — the GENUINE on-screen login anchor
 *      (class="enter_account"), targeting /personalarea/Login/.
 *
 * WK_HOME.ENTRY has NO candidate selective to the genuine login — every
 * candidate matches BOTH twins identically (same text, same aria-label). So:
 *   - origin/main (resolveVisible): every candidate's .first() lands on the
 *     DOM-first twin (Node A). Node A fails the hit-test, but resolveWinner
 *     FALLS BACK to fulfilled[0] (Hittest.ts) → returns the off-canvas twin.
 *   - PR #381 (resolveAllVisible + pickByAccessibleName): the visible set
 *     keeps the off-canvas twin (hit-test computed but NOT applied —
 *     Create/Resolve.ts runAllVisibleRace → diag.fulfilledIndices);
 *     pickByAccessibleName returns the DOM-FIRST 'ariaLabel' match, Node A.
 * BOTH branches therefore pick the off-canvas decoy and navigate to /help —
 * empirically confirmed on origin/main. PR #381 did NOT introduce this and
 * did NOT fix it; it merely surfaced it by migrating the only twin-shaped
 * bank into the pipeline.
 *
 * NOTE: the PR author's offline fixtures modelled the hidden node as
 * display:none, which Playwright EXCLUDES from the visible set, so those
 * fixtures could never surface this. Real Leumi uses an off-canvas
 * (Playwright-visible) node — reproduced faithfully here.
 *
 * P0 contract: this is the test-pyramid FOUNDATION. The desired behaviour
 * (reach the genuine login) currently FAILS on the origin/main baseline, so
 * it is marked it.failing to document the latent bug while keeping CI green.
 * P2 applies the GLOBAL resolver fix (prefer a hit-test-passing, real-href
 * interactive control over an off-canvas/hidden same-text decoy) and flips
 * this to a passing it(). No production code changes in P0.
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

const HOME_URL = 'https://www.example-bank.local/';
const REAL_LOGIN_URL = 'https://digital.example-bank.local/personalarea/Login/';
const LOGIN_PATH = '/personalarea/Login/';
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
 * Build a silent pino logger suitable for production code that does not
 * need log inspection.
 * @returns Silent pino logger.
 */
function silentLogger(): pino.Logger {
  return pino({ enabled: false });
}

/**
 * Provision a fresh context+page wired to the home + login + help fixtures.
 * The home page contains the off-canvas help twin (DOM-first) and the
 * genuine on-screen login anchor (DOM-second), both with text "כניסה לחשבון".
 * @returns Fresh context + page (caller must close the context).
 */
async function preparePage(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await setupRequestInterception(page, [
    {
      match: '/personalarea/Login',
      contentType: 'text/html',
      body: loadFixture('home-hidden-twin/login-page.html'),
    },
    {
      match: '/help/how-to-login',
      contentType: 'text/html',
      body: loadFixture('home-hidden-twin/manual-page.html'),
    },
    {
      match: 'www.example-bank.local/',
      contentType: 'text/html',
      body: loadFixture('home-hidden-twin/home-page.html'),
    },
    {
      match: /.*/,
      abort: true,
    },
  ]);
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
  return { context, page };
}

/**
 * Drive the real HOME PRE→ACTION code path against the provided page.
 * Same-tab DIRECT anchor — no navHrefOverride is expected; the executor
 * clicks the resolved trigger and the page navigates in place.
 * @param page - Live Playwright page (post-home goto).
 * @returns didNavigate flag from the real production code.
 */
async function runHomePreAndAction(page: Page): Promise<{ didNavigate: boolean }> {
  const logger = silentLogger();
  const mediator = createElementMediator(page);
  const discoveryResult = await resolveHomeStrategy(mediator, logger, page);
  if (!isOk(discoveryResult)) {
    throw new ScraperError('HOME PRE failed in visible/hidden twin test');
  }
  const executor = extractActionMediator(mediator, page);
  const didNavigate = await executeHomeNavigation(executor, discoveryResult.value, logger);
  return { didNavigate };
}

describe('HOME phase — visible/hidden same-text twin (latent shared-resolver bug)', () => {
  // P2 global fix landed (two layers): PRE — passive resolveVisible is
  // nth-aware + hit-test winner-picking, so it resolves the genuine
  // on-screen login over the off-canvas decoy; ACTION — buildIdentitySelector
  // conjoins the distinct href onto the shared aria-label, so the click
  // targets that exact element instead of re-resolving to the DOM-first
  // decoy. (Was it.failing on the buggy baseline.)
  it(
    'resolves the genuine on-screen login, not the off-canvas decoy (fixed globally in P2)',
    async () => {
      const { context, page } = await preparePage();
      try {
        await runHomePreAndAction(page);
        const finalUrl = page.url();
        expect(finalUrl).toContain(LOGIN_PATH);
        expect(finalUrl).toBe(REAL_LOGIN_URL);
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
