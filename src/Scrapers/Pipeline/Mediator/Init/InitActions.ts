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
 * ACTION: Navigate to the bank's base URL.
 * @param input - Pipeline context with browser + config.
 * @returns Same context after navigation, or failure.
 */
async function executeNavigateToBank(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'INIT ACTION: no browser');
  const page = input.browser.value.page;
  const targetUrl = input.config.urls.base;
  input.logger.debug({
    url: maskVisibleText(targetUrl),
    didNavigate: false,
  });
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    const landedUrl = page.url();
    input.logger.debug({
      url: maskVisibleText(landedUrl),
      didNavigate: true,
    });
    return succeed(input);
  } catch (error) {
    const msg = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `INIT ACTION: navigation failed — ${msg}`);
  }
}

/**
 * POST: Validate page loaded correctly (not blank).
 * @param input - Pipeline context with browser.
 * @returns Succeed if page valid, fail if blank.
 */
async function executeValidatePage(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'INIT POST: no browser');
  const page = input.browser.value.page;
  const currentUrl = page.url();
  const emptyTitle = '';
  const title = await page.title().catch((): string => emptyTitle);
  const isValid = currentUrl !== 'about:blank';
  input.logger.debug({
    url: maskVisibleText(currentUrl),
    title: maskVisibleText(title),
  });
  if (!isValid) return fail(ScraperErrorTypes.Generic, 'INIT POST: page is blank');
  return succeed(input);
}

/**
 * FINAL: Wire fetchStrategy + mediator into context → signal to HOME.
 * @param input - Pipeline context with browser.
 * @returns Updated context with mediator + fetchStrategy, or failure.
 */
function executeWireComponents(input: IPipelineContext): Procedure<IPipelineContext> {
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'INIT FINAL: no browser');
  const page = input.browser.value.page;
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
