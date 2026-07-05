/**
 * HOME phase entry-point selection — Mock-E2E integration test.
 *
 * Reproduces the forensically-confirmed Amex wrong-element bug: a bank
 * home page renders THREE login entry points sharing Wix markup —
 *
 *   1. an aria-label="כניסה לחשבון שלי" control (WK_HOME.ENTRY idx 1),
 *   2. a real <a href=…/personalarea/login/> aria-label="החשבון שלי"
 *      anchor (idx 6), and
 *   3. a collapsed navigation menu (idx 0, kept display:none).
 *
 * On Amex entry #1 renders as an href-less <button> (its Wix JS never
 * binds) → classifyStrategy = SEQUENTIAL → clicking it navigates
 * nowhere. Because WK_HOME.ENTRY ranks entry #1 ABOVE the real anchor,
 * resolveVisible returns the broken button and login never starts. On
 * Isracard the SAME component renders as a real <a href> → DIRECT →
 * login works (the GREEN control).
 *
 * This test drives the REAL HOME PRE (`resolveHomeStrategy`) +
 * ACTION (`executeHomeNavigation`) against a Camoufox-served fixture,
 * so the wrong-element pick surfaces as a failing strategy assertion —
 * the unit-mock tests could not, because they never raced a realistic
 * multi-candidate DOM. No real credentials are needed; this is the
 * pyramid test the original regression slipped through.
 */

import pino from 'pino';
import { type Browser, type BrowserContext, type Page } from 'playwright-core';

import ScraperError from '../../Scrapers/Base/ScraperError.js';
import {
  createElementMediator,
  extractActionMediator,
} from '../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import type { IElementMediator } from '../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { executeHomeNavigation } from '../../Scrapers/Pipeline/Mediator/Home/HomeActions.Navigate.js';
import {
  type IHomeDiscovery,
  NAV_STRATEGY,
  resolveHomeStrategy,
} from '../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { isOk } from '../../Scrapers/Pipeline/Types/Procedure.js';
import { closeSharedBrowser, getSharedBrowser } from './Helpers/BrowserFixture.js';
import { loadFixture, setupRequestInterception } from './Helpers/RequestInterceptor.js';

const BROWSER_BOOT_TIMEOUT_MS = 30000;
const TEST_TIMEOUT_MS = 90000;
const LOGIN_URL_FRAGMENT = '/personalarea/login/';

/** One cross-bank entry-selection case. */
interface IHomeEntryCase {
  /** Bank label for the test title. */
  readonly bank: string;
  /** Fixture path (relative to E2eMocked/fixtures). */
  readonly homeFixture: string;
  /** Substring that routes the home document to its fixture. */
  readonly homeHost: string;
  /** URL the page first navigates to (the home page). */
  readonly homeUrl: string;
  /** Trigger text of the DIRECT login anchor that MUST be picked. */
  readonly triggerText: string;
}

/** Bundled args for {@link driveAndProbe} — keeps params ≤3. */
interface IDriveArgs {
  readonly page: Page;
  readonly mediator: IElementMediator;
  readonly discovery: IHomeDiscovery;
  readonly logger: pino.Logger;
}

const HOME_ENTRY_CASES: readonly IHomeEntryCase[] = [
  {
    bank: 'Amex',
    homeFixture: 'home-entry-selection/amex-home.html',
    homeHost: 'americanexpress.co.il',
    homeUrl: 'https://www.americanexpress.co.il/',
    triggerText: 'החשבון שלי',
  },
  {
    bank: 'Isracard',
    homeFixture: 'home-entry-selection/isracard-home.html',
    homeHost: 'isracard.co.il',
    homeUrl: 'https://www.isracard.co.il/',
    triggerText: 'כניסה לחשבון שלי',
  },
];

let browser: Browser;

beforeAll(async () => {
  browser = await getSharedBrowser();
}, BROWSER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await closeSharedBrowser();
});

/**
 * Build a silent pino logger for production code that does not need
 * log inspection.
 * @returns Silent pino logger.
 */
function silentLogger(): pino.Logger {
  return pino({ enabled: false });
}

/**
 * Provision a fresh context+page wired to the bank's home + shared
 * login fixtures. The login route is registered BEFORE the host route
 * because the home host substring also matches the login URL (first
 * match wins).
 * @param testCase - Per-bank fixture + URL configuration.
 * @returns Fresh context + page (caller must close the context).
 */
async function preparePage(
  testCase: IHomeEntryCase,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await setupRequestInterception(page, [
    {
      match: '/personalarea/login',
      contentType: 'text/html',
      body: loadFixture('home-entry-selection/login-page.html'),
    },
    {
      match: testCase.homeHost,
      contentType: 'text/html',
      body: loadFixture(testCase.homeFixture),
    },
    {
      match: /.*/,
      abort: true,
    },
  ]);
  await page.goto(testCase.homeUrl, { waitUntil: 'domcontentloaded' });
  return { context, page };
}

/**
 * Drive the real HOME PRE discovery against the provided page.
 * @param page - Live Playwright page (post-home-goto).
 * @param mediator - Element mediator bound to the page.
 * @param logger - Silent pipeline logger.
 * @returns The discovery produced by the production resolver.
 */
async function resolveDiscovery(
  page: Page,
  mediator: IElementMediator,
  logger: pino.Logger,
): Promise<IHomeDiscovery> {
  const result = await resolveHomeStrategy(mediator, logger, page);
  if (!isOk(result)) {
    throw new ScraperError('HOME PRE failed in entry-selection test');
  }
  return result.value;
}

/**
 * Drive the real HOME ACTION on the discovered entry, then probe the
 * resulting page for the login form.
 * @param args - Bundled page, mediator, discovery, and logger.
 * @returns Final URL + count of reachable password fields.
 */
async function driveAndProbe(
  args: IDriveArgs,
): Promise<{ finalUrl: string; passwordCount: number }> {
  const executor = extractActionMediator(args.mediator, args.page);
  await executeHomeNavigation(executor, args.discovery, args.logger);
  const passwordCount = await args.page.locator('input[type="password"]').count();
  return { finalUrl: args.page.url(), passwordCount };
}

describe('HOME phase — entry-point selection (Amex wrong-element regression)', () => {
  it.each(HOME_ENTRY_CASES)(
    '$bank: HOME PRE picks the DIRECT login anchor and ACTION reaches the login page',
    async (testCase: IHomeEntryCase) => {
      const { context, page } = await preparePage(testCase);
      try {
        const logger = silentLogger();
        const mediator = createElementMediator(page);
        const discovery = await resolveDiscovery(page, mediator, logger);
        expect(discovery.strategy).toBe(NAV_STRATEGY.DIRECT);
        expect(discovery.triggerText).toBe(testCase.triggerText);
        const probe = await driveAndProbe({ page, mediator, discovery, logger });
        expect(probe.finalUrl).toContain(LOGIN_URL_FRAGMENT);
        expect(probe.passwordCount).toBeGreaterThan(0);
      } finally {
        await context.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
