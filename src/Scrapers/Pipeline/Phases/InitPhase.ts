/**
 * Init phase — browser launch + page setup + strategy + mediator creation.
 * Extracts logic from BaseScraperWithBrowser.initializePage() + setupPage().
 */

import type { Browser, BrowserContext, Page } from 'playwright-core';

import { buildContextOptions } from '../../../Common/Browser.js';
import { launchCamoufox } from '../../../Common/CamoufoxLauncher.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { IDefaultBrowserOptions, ScraperOptions } from '../../Base/Interface.js';
import createElementMediator from '../Mediator/CreateElementMediator.js';
import { createBrowserFetchStrategy } from '../Strategy/BrowserFetchStrategy.js';
import { toErrorMessage } from '../Types/ErrorUtils.js';
import { some } from '../Types/Option.js';
import type { IPipelineStep } from '../Types/Phase.js';
import type { IBrowserState, IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';

/** Whether a browser/page/context close operation succeeded. */
type CloseSuccess = boolean;

/**
 * Launch a new Camoufox browser.
 * @param options - Scraper options with browser config.
 * @returns Launched browser instance.
 */
async function launchBrowser(options: ScraperOptions): Promise<Browser> {
  const opts = options as IDefaultBrowserOptions;
  const isHeadless = !opts.shouldShowBrowser;
  const browser = await launchCamoufox(isHeadless);
  if (opts.prepareBrowser) await opts.prepareBrowser(browser);
  return browser;
}

/**
 * Create browser context and page from a browser.
 * @param browser - The browser to create context from.
 * @returns Object with context and page.
 */
async function createContextAndPage(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const contextOpts = buildContextOptions();
  const context = await browser.newContext(contextOpts);
  try {
    const page = await context.newPage();
    return { context, page };
  } catch (err) {
    await context.close().catch((): CloseSuccess => false);
    throw err;
  }
}

/**
 * Configure a page with timeouts and interceptors.
 * @param page - The page to configure.
 * @param options - Scraper options.
 * @returns True after setup completes.
 */
async function setupPage(page: Page, options: ScraperOptions): Promise<boolean> {
  if (options.defaultTimeout) {
    page.setDefaultTimeout(options.defaultTimeout);
  }
  if (options.preparePage) {
    await options.preparePage(page);
  }
  return true;
}

/**
 * Build cleanup handlers for browser lifecycle.
 * @param page - The page to close.
 * @param context - The browser context to close.
 * @param browser - The browser to close.
 * @returns Ordered cleanup array (page → context → browser).
 */
function buildCleanups(
  page: Page,
  context: BrowserContext,
  browser: Browser,
): readonly (() => Promise<CloseSuccess>)[] {
  return [
    (): Promise<CloseSuccess> => browser.close().then((): CloseSuccess => true),
    (): Promise<CloseSuccess> => context.close().then((): CloseSuccess => true),
    (): Promise<CloseSuccess> => page.close().then((): CloseSuccess => true),
  ];
}

/**
 * Build the browser state from launched components.
 * @param page - The Playwright page.
 * @param context - The browser context.
 * @param browser - The browser instance.
 * @returns IBrowserState with page, context, and cleanups.
 */
function buildBrowserState(page: Page, context: BrowserContext, browser: Browser): IBrowserState {
  const cleanups = buildCleanups(page, context, browser);
  const state: IBrowserState = { page, context, cleanups };
  return state;
}

/** Launched browser components for wiring into context. */
interface ILaunchedBrowser {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
}

/**
 * Wire browser components into context after successful launch.
 * @param input - The base context to extend.
 * @param launched - The launched browser, context, and page.
 * @returns New context with browser, fetchStrategy, mediator.
 */
function wireComponents(input: IPipelineContext, launched: ILaunchedBrowser): IPipelineContext {
  const state = buildBrowserState(launched.page, launched.context, launched.browser);
  const fetchStrategy = createBrowserFetchStrategy(launched.page);
  const mediator = createElementMediator(launched.page);
  const ctx: IPipelineContext = {
    ...input,
    browser: some(state),
    fetchStrategy: some(fetchStrategy),
    mediator: some(mediator),
  };
  return ctx;
}

/**
 * Execute the init phase — launch browser, create page, wire strategy + mediator.
 * @param ctx - Current pipeline context.
 * @param input - Input context to extend.
 * @returns New context with browser, fetchStrategy, and mediator populated.
 */
/**
 * Close a browser handle if it was successfully launched. Swallows errors.
 * @param browser - Browser handle or false if not yet launched.
 * @returns True if closed, false if no browser or close failed.
 */
async function closeBrowserSafe(browser: Browser | false): Promise<CloseSuccess> {
  if (!browser) return false;
  return browser
    .close()
    .then((): CloseSuccess => true)
    .catch((): CloseSuccess => false);
}

/**
 * Execute the init phase — launch browser, create page, wire strategy + mediator.
 * @param ctx - Current pipeline context.
 * @param input - Input context to extend.
 * @returns New context with browser, fetchStrategy, and mediator populated.
 */
async function executeInit(
  ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  let browser: Browser | false = false;
  try {
    browser = await launchBrowser(ctx.options);
    const { context, page } = await createContextAndPage(browser);
    await setupPage(page, ctx.options);
    const result = wireComponents(input, { browser, context, page });
    return succeed(result);
  } catch (error) {
    await closeBrowserSafe(browser);
    const msg = toErrorMessage(error as Error);
    ctx.logger.debug('InitPhase failed: %s', msg);
    return fail(ScraperErrorTypes.Generic, `InitPhase failed: ${msg}`);
  }
}

/** Init phase step — launches browser and creates page. */
const INIT_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'init-browser',
  execute: executeInit,
};

export default INIT_STEP;
export { INIT_STEP };
