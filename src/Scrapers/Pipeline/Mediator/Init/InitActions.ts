/**
 * INIT phase Mediator actions — browser launch, navigation, validation, wiring.
 * Phase orchestrates ONLY. All logic here.
 */

import type { Browser, BrowserContext } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { installMockContextRoute } from '../../Interceptors/MockInterceptorIO.js';
import {
  buildBrowserState,
  closeBrowserSafe,
  createContextAndPage,
  launchBrowser,
  setupPage,
} from '../../Phases/Init/InitBrowserSetup.js';
import { createBrowserFetchStrategy } from '../../Strategy/Fetch/BrowserFetchStrategy.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { some } from '../../Types/Option.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import createElementMediator from '../Elements/CreateElementMediator.js';
import { INIT_DOM_READY_TIMEOUT_MS, INIT_NAV_COMMIT_TIMEOUT_MS } from '../Timing/TimingConfig.js';

/**
 * Cold-Start protocol — when DUMP_SNAPSHOTS=1, strip every cookie so
 * device-remembered banks (Hapoalim) present the full OTP challenge.
 * Needed to capture a high-fidelity otp-fill.html with PIN inputs visible.
 * @param context - Browser context to sanitise.
 * @returns True when DUMP_SNAPSHOTS was active and cookies were cleared,
 * false when the dump flag was off and the call was a no-op.
 */
async function coldStartIfDumping(context: BrowserContext): Promise<boolean> {
  const isDumping = process.env.DUMP_SNAPSHOTS === '1' || process.env.DUMP_SNAPSHOTS === 'true';
  if (!isDumping) return false;
  await context.clearCookies().catch((): false => false);
  return true;
}

/**
 * PRE: Launch browser, create page, wire browser state into context.
 * Applies Cold-Start + mock route install before navigation.
 * @param input - Pipeline context with options.
 * @returns Updated context with browser state, or failure.
 */
async function executeLaunchBrowser(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  let browser: Browser | false = false;
  try {
    browser = await launchBrowser(input.options);
    const launched = await createContextAndPage(browser);
    await coldStartIfDumping(launched.context);
    await installMockContextRoute(launched.context, input.companyId);
    await setupPage(launched.page, input.options);
    const state = buildBrowserState(launched.page, launched.context, browser);
    return succeed({ ...input, browser: some(state) });
  } catch (error) {
    await closeBrowserSafe(browser);
    const msg = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `INIT PRE: browser launch failed — ${msg}`);
  }
}

/**
 * ACTION: Open the bank's base URL — fires the navigation. Uses
 * Playwright's lightest lifecycle event (`'commit'`) so this stage
 * returns the moment the server responds with the first byte
 * (TLS done + HTTP headers received). HTML parsing and `load`
 * happen in subsequent stages.
 *
 * <p>ZERO dependency on other INIT functions. Reads `input.browser`
 * + `input.config.urls.base` only; emits no new ctx field — the
 * navigation is a side effect on the page, validated by POST.
 *
 * @param input - Pipeline context with browser + config.
 * @returns Same context after the commit lands, or failure.
 */
async function executeNavigateToBank(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'INIT ACTION: no browser');
  const page = input.browser.value.page;
  const targetUrl = input.config.urls.base;
  input.logger.debug({ url: maskVisibleText(targetUrl), didNavigate: false });
  try {
    await page.goto(targetUrl, {
      waitUntil: 'commit',
      timeout: INIT_NAV_COMMIT_TIMEOUT_MS,
    });
    return succeed(input);
  } catch (error) {
    const msg = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `INIT ACTION: navigation failed — ${msg}`);
  }
}

/**
 * POST: Validate the navigation committed — page URL is no longer
 * `about:blank`. Pure observation: zero clicks, zero HTML scan,
 * zero WK lookup. The commit wait already happened in ACTION; POST
 * is the sanity gate that confirms it landed.
 *
 * <p>ZERO dependency on other INIT functions. Reads `input.browser`
 * only; emits no new ctx field.
 *
 * @param input - Pipeline context with browser.
 * @returns Succeed when URL committed, fail when still blank.
 */
function executeValidatePage(input: IPipelineContext): Procedure<IPipelineContext> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'INIT POST: no browser');
  const page = input.browser.value.page;
  const currentUrl = page.url();
  input.logger.debug({ url: maskVisibleText(currentUrl) });
  if (currentUrl === 'about:blank') {
    return fail(ScraperErrorTypes.Generic, 'INIT POST: page is blank');
  }
  return succeed(input);
}

/**
 * FINAL: Validate the DOM finished parsing
 * (`page.waitForLoadState('domcontentloaded')`), then wire
 * `fetchStrategy` + `mediator` + `diagnostics.loginUrl` so HOME
 * has its inputs. Uses {@link INIT_DOM_READY_TIMEOUT_MS} (10 s);
 * fails loud when the page never reaches DOMContentLoaded.
 *
 * <p>We deliberately do NOT wait for the `load` event — empirical
 * Camoufox probe (2026-05-10) showed half the browser-flow banks
 * (max / amex / isracard) take 12–15 s to fire `load` because
 * marketing / analytics scripts gate it. The framework never
 * reads `window.onload`, so waiting for it adds latency without
 * value. `domcontentloaded` is the right "page is usable" signal.
 *
 * <p>ZERO HTML scanning — `waitForLoadState` is a browser-event
 * listener, not a DOM query. ZERO dependency on other INIT
 * functions. Reads `input.browser` + `input.diagnostics`; emits
 * the new fields above.
 *
 * @param input - Pipeline context with browser.
 * @returns Updated context with mediator + fetchStrategy, or fail.
 */
async function executeWireComponents(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'INIT FINAL: no browser');
  const page = input.browser.value.page;
  const wasReady = await page
    .waitForLoadState('domcontentloaded', { timeout: INIT_DOM_READY_TIMEOUT_MS })
    .then((): true => true)
    .catch((): false => false);
  if (!wasReady) {
    return fail(ScraperErrorTypes.Generic, 'INIT FINAL: domcontentloaded not observed');
  }
  const fetchStrategy = createBrowserFetchStrategy(page);
  const mediator = createElementMediator(page);
  const loginUrl = page.url();
  const diag = { ...input.diagnostics, loginUrl };
  return succeed({
    ...input,
    fetchStrategy: some(fetchStrategy),
    mediator: some(mediator),
    diagnostics: diag,
  });
}

export { executeLaunchBrowser, executeNavigateToBank, executeValidatePage, executeWireComponents };
