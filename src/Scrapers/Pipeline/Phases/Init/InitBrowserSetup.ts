/**
 * Init browser setup — launch, context, page creation, cleanup handlers.
 * Extracted from InitPhase.ts to respect max-lines.
 */

import type { Browser, BrowserContext, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IDefaultBrowserOptions, ScraperOptions } from '../../../Base/Interface.js';
import { buildContextOptions } from '../../Mediator/Browser/BrowserContextBuilder.js';
import {
  isSessionEnabled,
  loadSessionState,
  saveSessionStateSafe,
} from '../../Mediator/Browser/BrowserSessionStore.js';
import { launchCamoufox } from '../../Mediator/Browser/CamoufoxLauncher.js';
import type { Brand } from '../../Types/Brand.js';
import type { IBrowserState } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';

/** Static and PII-free: the bank id and path stay out of the log line. */
const SESSION_SAVE_FAILED = 'Browser session save failed';

/** Per-step browser-lifecycle outcome — branded so Rule #15 accepts it. */
type DidLifecycleStep = Brand<boolean, 'DidLifecycleStep'>;

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
 * Create browser context and page from a browser, restoring the bank's saved
 * session when one exists so the origin sees a returning visitor.
 * @param browser - The browser to create context from.
 * @param companyId - Bank identifier keying the saved session.
 * @returns Object with context and page.
 */
async function createContextAndPage(
  browser: Browser,
  companyId: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const saved = loadSessionState(companyId);
  const contextOpts = buildContextOptions(saved);
  const context = await browser.newContext(contextOpts);
  try {
    const page = await context.newPage();
    return { context, page };
  } catch (error) {
    await context.close().catch((): DidLifecycleStep => false as DidLifecycleStep);
    throw error;
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

/** Launched browser handles plus the bank they belong to. */
interface ILaunchedBrowser {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly browser: Browser;
  readonly companyId: string;
}

/**
 * Cleanup that persists the session while the context is still alive.
 *
 * <p>Ordered LAST in {@link buildCleanups} on purpose: the pipeline drains
 * cleanups LIFO, so the last entry runs first. Closing the browser takes the
 * context's cookies with it, and `storageState` on a closed context throws —
 * a save placed anywhere else would silently persist nothing.
 *
 * <p>Reports a failed save rather than swallowing it. The drain tallies each
 * cleanup and moves on, so this costs nothing but buys a log line the silent
 * version never gave us. A disabled feature is not a failure, hence the
 * {@link isSessionEnabled} guard.
 * @param launched - Launched handles + bank id.
 * @returns Async cleanup returning Procedure.
 */
function saveHandler(launched: ILaunchedBrowser): () => Promise<Procedure<void>> {
  return async (): Promise<Procedure<void>> => {
    const didWrite = await saveSessionStateSafe(launched.context, launched.companyId);
    if (didWrite || !isSessionEnabled()) return succeed(undefined);
    return fail(ScraperErrorTypes.Generic, SESSION_SAVE_FAILED);
  };
}

/**
 * Build cleanup handlers for browser lifecycle. Consumers drain this array
 * LIFO, so it reads back-to-front: save, page, context, browser.
 * @param launched - Launched handles + bank id.
 * @returns Ordered cleanup array.
 */
function buildCleanups(launched: ILaunchedBrowser): IBrowserState['cleanups'] {
  const { page, context, browser } = launched;
  return [closeHandler(browser), closeHandler(context), closeHandler(page), saveHandler(launched)];
}

/**
 * Build the browser state from launched components.
 * @param launched - Launched handles + bank id.
 * @returns IBrowserState with page, context, and cleanups.
 */
function buildBrowserState(launched: ILaunchedBrowser): IBrowserState {
  const cleanups = buildCleanups(launched);
  return { page: launched.page, context: launched.context, cleanups };
}

/**
 * Close a browser handle if it was successfully launched.
 * @param browser - Browser handle or false if not yet launched.
 * @returns True if closed, false if no browser or close failed.
 */
async function closeBrowserSafe(browser: Browser | false): Promise<DidLifecycleStep> {
  if (!browser) return false as DidLifecycleStep;
  return browser
    .close()
    .then((): DidLifecycleStep => true as DidLifecycleStep)
    .catch((): DidLifecycleStep => false as DidLifecycleStep);
}

export type { ILaunchedBrowser };
export { buildBrowserState, closeBrowserSafe, createContextAndPage, launchBrowser, setupPage };
