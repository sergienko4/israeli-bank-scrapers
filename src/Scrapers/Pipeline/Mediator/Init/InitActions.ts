/**
 * INIT phase Mediator actions — browser launch, navigation, validation, wiring.
 * Phase orchestrates ONLY. All logic here.
 */

import type { Browser } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
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

/** Whether the page loaded with a valid status. */
type PageValid = boolean;
/** Browser page title string. */
type PageTitle = string;

/**
 * PRE: Launch browser, create page, wire browser state into context.
 * @param input - Pipeline context with options.
 * @returns Updated context with browser state, or failure.
 */
async function executeLaunchBrowser(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  let browser: Browser | false = false;
  try {
    browser = await launchBrowser(input.options);
    const launched = await createContextAndPage(browser);
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
    event: 'navigation',
    phase: 'init',
    url: maskVisibleText(targetUrl),
    didNavigate: false,
  });
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    const landedUrl = page.url();
    input.logger.debug({
      event: 'navigation',
      phase: 'init',
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
  const emptyTitle: PageTitle = '';
  const title = await page.title().catch((): PageTitle => emptyTitle);
  const isValid: PageValid = currentUrl !== 'about:blank';
  input.logger.debug({
    event: 'page-validate',
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
