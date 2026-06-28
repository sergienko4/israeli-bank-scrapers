/**
 * HOME resolver integration test — drives the PRODUCTION `resolveHomeStrategy`
 * against tiny, FAITHFUL (inline-CSS) synthetic fixtures that reproduce the two
 * cross-bank HOME-resolution shapes the Bank Leumi migration exposed. Zero
 * network, no credentials, no captured marketing HTML (so no PII / copyright
 * surface) — yet trustworthy where the captured fixtures were not.
 *
 * <p>WHY SYNTHETIC + INLINE CSS (the false-green that shipped a regression):
 * the committed `01-home.html` snapshots link EXTERNAL stylesheets that this
 * offline suite BLOCKS → the page renders UNSTYLED → a CSS-hidden decoy renders
 * VISIBLE → the fixture yields a DIFFERENT resolver outcome than the live site.
 * That infidelity is exactly why a 6-bank HOME regression sailed through green.
 * These fixtures inline the ONE rule that matters (`display:none` on the hidden
 * decoy) so the offline DOM matches live visibility and the regression is
 * catchable here — the "100% simulator" trust the captures could not give.
 *
 * <p>Contracts (PROVIDER-AGNOSTIC — no per-bank flag; one rule for every bank):
 * <ol>
 *   <li>LEUMI SHAPE → DIRECT: the login name "כניסה לחשבון" sits on a hidden
 *       0×0 `display:none` decoy `<a href="#">`, a no-href page WRAPPER div, and
 *       the real visible `<a class="enter_account" href="hb2.bankleumi.co.il/…">`.
 *       The resolver must pick the real anchor BY ACCESSIBLE NAME → DIRECT to
 *       hb2.bankleumi.co.il. The pre-fix single-winner race picked the no-href
 *       wrapper div → SEQUENTIAL / no navigation — the regression this locks.</li>
 *   <li>MARKETING-STRAND INVARIANT (Beinleumi/Max shape): when the real login is
 *       a JS toggle (`href="#"`) and a third-party MARKETING link (YouTube) of a
 *       DIFFERENT accessible name is present, the resolver must NEVER navigate to
 *       the marketing host (the opt-in "any real href" bug, avoided by keying on
 *       the login accessible name).</li>
 * </ol>
 */

import type { Page } from 'playwright-core';

import { createElementMediator } from '../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import {
  NAV_STRATEGY,
  resolveHomeStrategy,
} from '../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { newFixturePage } from '../Helpers/FixturePage.js';
import {
  closeIntegrationBrowser,
  getIntegrationBrowser,
} from '../Helpers/IntegrationBrowserFixture.js';
import { closeQuietly, makeSilentLogger } from '../Helpers/IntegrationDriveAssertions.js';

const BROWSER_BOOT_TIMEOUT_MS = 120000;
const DRIVE_TIMEOUT_MS = 120000;
const SET_CONTENT_TIMEOUT_MS = 15000;

const LEUMI_LOGIN_HREF = 'https://hb2.bankleumi.co.il/H/Login.html';
const MARKETING_HREF = 'https://www.youtube.com/watch?v=promo';

/** Discovery outcome from {@link resolveHomeStrategy}. */
type HomeOutcome = Awaited<ReturnType<typeof resolveHomeStrategy>>;

/**
 * Leumi-shape HOME: a hidden `display:none` decoy `<a href="#">`, a no-href
 * page wrapper div carrying the text deep inside, and the real visible
 * `enter_account` anchor — all sharing the accessible name "כניסה לחשבון".
 * Inline CSS keeps the decoy hidden offline exactly as it is live.
 */
const LEUMI_FAITHFUL_HTML = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8" /><title>בנק לאומי</title>
<style>.hidden-nav{display:none}</style></head>
<body>
  <div class="dialog-off-canvas-main-canvas">
    <nav class="hidden-nav" aria-hidden="true">
      <a href="#" aria-label="כניסה לחשבון">כניסה לחשבון</a>
    </nav>
    <header>
      <a class="enter_account" href="${LEUMI_LOGIN_HREF}"><span>כניסה לחשבון</span></a>
    </header>
  </div>
</body></html>`;

/**
 * Beinleumi/Max-shape HOME: the real login is a JS toggle (`href="#"`) and the
 * only absolute href on the page belongs to a third-party MARKETING link with a
 * DIFFERENT accessible name — which the resolver must never follow.
 */
const MARKETING_STRAND_HTML = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8" /><title>בנק</title></head>
<body>
  <header>
    <a href="#" class="login-toggle">כניסה לחשבון</a>
    <a href="${MARKETING_HREF}" class="promo">צפו בסרטון</a>
  </header>
</body></html>`;

/**
 * Render `html` on a blocked-network page and run the PRODUCTION HOME resolver.
 * @param page - Blocked-network fixture page.
 * @param html - Faithful (inline-CSS) HOME fixture to render via `setContent`.
 * @returns The production HOME discovery outcome.
 */
async function runResolverOnPage(page: Page, html: string): Promise<HomeOutcome> {
  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: SET_CONTENT_TIMEOUT_MS });
  const mediator = createElementMediator(page);
  const logger = makeSilentLogger();
  return resolveHomeStrategy(mediator, logger, page);
}

/**
 * Boot a blocked-network page, render `html`, and run the PRODUCTION HOME
 * resolver against it. The page is always closed so the context never leaks.
 * @param html - Faithful (inline-CSS) HOME fixture to render via `setContent`.
 * @returns The production HOME discovery outcome.
 */
async function resolveHomeOnHtml(html: string): Promise<HomeOutcome> {
  const browser = await getIntegrationBrowser();
  const page: Page = await newFixturePage(browser);
  try {
    return await runResolverOnPage(page, html);
  } finally {
    await closeQuietly(page);
  }
}

describe('HOME resolver — provider-agnostic, faithful (inline-CSS) fixtures', () => {
  beforeAll(async () => {
    await getIntegrationBrowser();
  }, BROWSER_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await closeIntegrationBrowser();
  });

  it(
    'Leumi shape: resolves the real hb2.bankleumi.co.il login by accessible name, not the no-href wrapper',
    async () => {
      const outcome = await resolveHomeOnHtml(LEUMI_FAITHFUL_HTML);
      expect(outcome.success).toBe(true);
      if (outcome.success) {
        expect(outcome.value.strategy).toBe(NAV_STRATEGY.DIRECT);
        expect(outcome.value.navHrefOverride).toBe(LEUMI_LOGIN_HREF);
      }
    },
    DRIVE_TIMEOUT_MS,
  );

  it(
    'Marketing-strand invariant: a JS-toggle login never navigates to a third-party marketing host',
    async () => {
      const outcome = await resolveHomeOnHtml(MARKETING_STRAND_HTML);
      expect(outcome.success).toBe(true);
      if (outcome.success) {
        expect(outcome.value.navHrefOverride ?? '').not.toBe(MARKETING_HREF);
        expect(outcome.value.strategy).not.toBe(NAV_STRATEGY.DIRECT);
      }
    },
    DRIVE_TIMEOUT_MS,
  );
});
