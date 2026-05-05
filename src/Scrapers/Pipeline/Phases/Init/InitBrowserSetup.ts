/**
 * Init browser setup — launch, context, page creation, cleanup handlers.
 * Extracted from InitPhase.ts to respect max-lines.
 */

import type { Browser, BrowserContext, Page } from 'playwright-core';

import type { IDefaultBrowserOptions, ScraperOptions } from '../../../Base/Interface.js';
import { buildContextOptions } from '../../Mediator/Browser/BrowserContextBuilder.js';
import { launchCamoufox } from '../../Mediator/Browser/CamoufoxLauncher.js';
import type { IBrowserState } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

/** Whether a close call succeeded. */
type CloseDone = boolean;

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
    await context.close().catch((): CloseDone => false);
    throw err;
  }
}

/**
 * Configure a page with timeouts and interceptors.
 * @param pg - The page to configure.
 * @param options - Scraper options.
 * @returns Succeed after setup completes.
 */
async function setupPage(pg: Page, options: ScraperOptions): Promise<Procedure<void>> {
  if (options.defaultTimeout) {
    pg.setDefaultTimeout(options.defaultTimeout);
  }
  if (options.preparePage) {
    await options.preparePage(pg);
  }
  return succeed(undefined);
}

/** Closeable resource interface for cleanup handlers. */
interface ICloseable {
  close: () => Promise<void>;
}

/**
 * Create a cleanup handler that closes a closeable resource.
 * @param closeable - Resource with a close() method.
 * @returns Async function returning Procedure.
 */
function closeHandler(closeable: ICloseable): () => Promise<Procedure<void>> {
  return (): Promise<Procedure<void>> =>
    closeable.close().then((): Procedure<void> => succeed(undefined));
}

/**
 * Build cleanup handlers for browser lifecycle.
 * @param thePage - The page to close.
 * @param theContext - The browser context to close.
 * @param theBrowser - The browser to close.
 * @returns Ordered cleanup array.
 */
function buildCleanups(
  thePage: Page,
  theContext: BrowserContext,
  theBrowser: Browser,
): IBrowserState['cleanups'] {
  return [closeHandler(theBrowser), closeHandler(theContext), closeHandler(thePage)];
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
  return { page, context, cleanups };
}

/**
 * Close a browser handle if it was successfully launched.
 * @param browser - Browser handle or false if not yet launched.
 * @returns True if closed, false if no browser or close failed.
 */
async function closeBrowserSafe(browser: Browser | false): Promise<CloseDone> {
  if (!browser) return false;
  return browser
    .close()
    .then((): CloseDone => true)
    .catch((): CloseDone => false);
}

export { buildBrowserState, closeBrowserSafe, createContextAndPage, launchBrowser, setupPage };
