/**
 * R3 guard: HOME nav override is target="_blank"-driven.
 */

import pino from 'pino';
import { type Browser, type BrowserContext, type Page } from 'playwright-core';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import { createElementMediator } from '../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import type { IHomeDiscovery } from '../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { resolveHomeStrategy } from '../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { isOk } from '../../../Scrapers/Pipeline/Types/Procedure.js';
import { closeSharedBrowser, getSharedBrowser } from '../Helpers/BrowserFixture.js';
import { loadFixture, setupRequestInterception } from '../Helpers/RequestInterceptor.js';

const MARKETING_URL = 'https://www.example-bank.local/';
const LOGIN_URL = 'https://digital.example-bank.local/personalarea/Login/';
const BROWSER_BOOT_TIMEOUT_MS = 30000;
const TEST_TIMEOUT_MS = 90000;

let browser: Browser;

interface IGuardCase {
  readonly fixtureRoot: string;
  readonly expectedOverride: string | undefined;
}

interface IPreparedPage {
  readonly context: BrowserContext;
  readonly page: Page;
}

type MockRoutes = Parameters<typeof setupRequestInterception>[1];
type MockRoute = MockRoutes[number];

beforeAll(async () => {
  browser = await getSharedBrowser();
}, BROWSER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await closeSharedBrowser();
});

/**
 * Builds a silent logger for production HOME resolver code.
 * @returns Silent pino logger.
 */
function silentLogger(): pino.Logger {
  return pino({ enabled: false });
}

/**
 * Creates one HTML fixture route.
 * @param fixtureRoot - Fixture directory under E2eMocked fixtures.
 * @param fileName - HTML file name inside the fixture directory.
 * @param match - URL substring matched by the route.
 * @returns Mock route descriptor.
 */
function buildHtmlRoute(fixtureRoot: string, fileName: string, match: string): MockRoute {
  const fixturePath = `${fixtureRoot}/${fileName}`;
  const body = loadFixture(fixturePath);
  return { match, contentType: 'text/html', body };
}

/**
 * Creates fixture routes for the requested HOME page shape.
 * @param fixtureRoot - Fixture directory under E2eMocked fixtures.
 * @returns Mock route descriptors.
 */
function buildRoutes(fixtureRoot: string): MockRoutes {
  const loginRoute = buildHtmlRoute(fixtureRoot, 'login-page.html', '/personalarea/Login');
  const marketingRoute = buildHtmlRoute(fixtureRoot, 'marketing-page.html', 'example-bank.local');
  const abortRoute = { match: /.*/, abort: true };
  return [loginRoute, marketingRoute, abortRoute];
}

/**
 * Opens the marketing fixture with production-like request interception.
 * @param fixtureRoot - Fixture directory under E2eMocked fixtures.
 * @returns Fresh browser context and page.
 */
async function preparePage(fixtureRoot: string): Promise<IPreparedPage> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const routes = buildRoutes(fixtureRoot);
  await setupRequestInterception(page, routes);
  await page.goto(MARKETING_URL, { waitUntil: 'domcontentloaded' });
  return { context, page };
}

/**
 * Resolves the HOME discovery object with real mediator extraction.
 * @param page - Live fixture page.
 * @returns HOME discovery.
 */
async function resolveDiscovery(page: Page): Promise<IHomeDiscovery> {
  const mediator = createElementMediator(page);
  const logger = silentLogger();
  const discovery = await resolveHomeStrategy(mediator, logger, page);
  if (!isOk(discovery))
    throw new ScraperError('HOME PRE expected to resolve in R3 nav-override guard');
  return discovery.value;
}

/**
 * Asserts navHrefOverride for one captured fixture.
 * @param guardCase - Fixture and expected override contract.
 * @returns True after assertions complete.
 */
async function expectOverride(guardCase: IGuardCase): Promise<boolean> {
  const { context, page } = await preparePage(guardCase.fixtureRoot);
  try {
    const discovery = await resolveDiscovery(page);
    expect(discovery.navHrefOverride).toBe(guardCase.expectedOverride);
  } finally {
    await context.close();
  }
  return true;
}

describe('HOME phase — R3 nav-override target guard', () => {
  it(
    'does not attach navHrefOverride for an absolute href without target="_blank"',
    async () =>
      expectOverride({ fixtureRoot: 'home-absolute-href-no-blank', expectedOverride: undefined }),
    TEST_TIMEOUT_MS,
  );

  it(
    'attaches navHrefOverride for an absolute href with target="_blank"',
    async () => expectOverride({ fixtureRoot: 'home-target-blank', expectedOverride: LOGIN_URL }),
    TEST_TIMEOUT_MS,
  );
});
