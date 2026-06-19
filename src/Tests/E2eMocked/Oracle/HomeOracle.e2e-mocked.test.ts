import { readFileSync } from 'node:fs';

import pino from 'pino';
import { type Browser, type BrowserContext, type Page } from 'playwright-core';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import {
  createElementMediator,
  extractActionMediator,
} from '../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import { executeHomeNavigation } from '../../../Scrapers/Pipeline/Mediator/Home/HomeActions.Navigate.js';
import { resolveHomeStrategy } from '../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { isOk } from '../../../Scrapers/Pipeline/Types/Procedure.js';
import { closeSharedBrowser, getSharedBrowser } from '../Helpers/BrowserFixture.js';
import { setupRequestInterception } from '../Helpers/RequestInterceptor.js';

const HOME_URL = 'https://www.example-bank.local/';
const REAL_LOGIN_URL = 'https://digital.example-bank.local/personalarea/Login/';
const LOGIN_PATH = '/personalarea/Login/';
const BROWSER_BOOT_TIMEOUT_MS = 30000;
const TEST_TIMEOUT_MS = 90000;

let browser: Browser;

interface IPreparedPage {
  readonly context: BrowserContext;
  readonly page: Page;
}

type MockRoutes = Parameters<typeof setupRequestInterception>[1];

/**
 * Loads a PII-free oracle HTML fixture.
 * @param relativePath - Fixture path below this test directory.
 * @returns Fixture body.
 */
function loadOracleFixture(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const HOME_ROUTES: MockRoutes = [
  {
    match: '/personalarea/Login',
    contentType: 'text/html',
    body: loadOracleFixture('fixtures/home/login.html'),
  },
  {
    match: '/help/how-to-login',
    contentType: 'text/html',
    body: loadOracleFixture('fixtures/home/manual.html'),
  },
  {
    match: 'www.example-bank.local/',
    contentType: 'text/html',
    body: loadOracleFixture('fixtures/home/home.html'),
  },
  { match: /.*/, abort: true },
];

beforeAll(async () => {
  browser = await getSharedBrowser();
}, BROWSER_BOOT_TIMEOUT_MS);

afterAll(async () => {
  await closeSharedBrowser();
});

/**
 * Builds a silent logger for production HOME code.
 * @returns Silent pino logger.
 */
function silentLogger(): pino.Logger {
  return pino({ enabled: false });
}

/**
 * Opens the representative home fixture.
 * @returns Fresh browser context and page.
 */
async function preparePage(): Promise<IPreparedPage> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await setupRequestInterception(page, HOME_ROUTES);
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
  return { context, page };
}

/**
 * Runs HOME PRE and ACTION through production mediators.
 * @param page - Live fixture page.
 * @returns Navigation outcome.
 */
async function runHomePreAndAction(page: Page): Promise<{ readonly didNavigate: boolean }> {
  const logger = silentLogger();
  const mediator = createElementMediator(page);
  const result = await resolveHomeStrategy(mediator, logger, page);
  if (!isOk(result)) throw new ScraperError('HOME PRE failed in oracle');
  const executor = extractActionMediator(mediator, page);
  return { didNavigate: await executeHomeNavigation(executor, result.value, logger) };
}

describe('Leumi oracle — home trigger readiness', () => {
  it(
    'resolves the hit-test-passing login control over an off-canvas same-name twin',
    async () => {
      const { context, page } = await preparePage();
      try {
        await runHomePreAndAction(page);
        const finalUrl = page.url();
        const passwordCount = await page.getByPlaceholder('סיסמה').count();
        expect(finalUrl).toBe(REAL_LOGIN_URL);
        expect(passwordCount).toBe(1);
        expect(finalUrl).toContain(LOGIN_PATH);
      } finally {
        await context.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
