/**
 * Init browser setup — launch, context, page creation, cleanup handlers.
 * Extracted from InitPhase.ts to respect max-lines.
 */

import type { Browser, BrowserContext, Page } from 'playwright-core';

import type { IDefaultBrowserOptions, ScraperOptions } from '../../../Base/Interface.js';
import { buildContextOptions } from '../../Mediator/Browser/BrowserContextBuilder.js';
import {
  buildCloseAndStripCleanup,
  launchCamoufoxForBank,
} from '../../Mediator/Browser/CamoufoxLauncher.js';
import type { Brand } from '../../Types/Brand.js';
import type { IBrowserState } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

/** Per-step browser-lifecycle outcome — branded so Rule #15 accepts it. */
type DidLifecycleStep = Brand<boolean, 'DidLifecycleStep'>;

/**
 * Launch result discriminator — the persistent-profile path returns
 * a {@link BrowserContext}, the ephemeral path returns a {@link Browser}.
 * Callers must narrow before treating the result.
 */
type LaunchResult = Browser | BrowserContext;

/**
 * Launch a Camoufox session for the bank identified by `companyId`.
 *
 * When `USE_PERSISTENT_PROFILES=true`, the resulting session is backed
 * by a per-bank profile dir; otherwise a fresh ephemeral browser is
 * launched (legacy behaviour). Either way the optional
 * `prepareBrowser` hook still runs on the Browser-typed handle when
 * present — the persistent-context path skips it since there is no
 * Browser handle to pass.
 * @param options - Scraper options with browser config and `companyId`.
 * @returns Launched browser (ephemeral) or browser context (persistent).
 */
async function launchBrowser(options: ScraperOptions): Promise<LaunchResult> {
  const opts = options as IDefaultBrowserOptions;
  const isHeadless = !opts.shouldShowBrowser;
  const result = await launchCamoufoxForBank(isHeadless, options.companyId);
  if (opts.prepareBrowser && 'newContext' in result) await opts.prepareBrowser(result);
  return result;
}

/**
 * Open a page on a freshly-created ephemeral context, closing the
 * context if `newPage` throws so the caller doesn't leak.
 * @param browser - Browser handle from the ephemeral launcher path.
 * @returns Resolved context + page pair.
 */
async function ephemeralContextAndPage(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const contextOpts = buildContextOptions();
  const context = await browser.newContext(contextOpts);
  try {
    const page = await context.newPage();
    return { context, page };
  } catch (error) {
    const closed = context.close();
    await closed.catch((): DidLifecycleStep => false as DidLifecycleStep);
    throw error;
  }
}

/**
 * Reuse the first page of a persistent context, opening a new one when
 * the restored profile has none yet.
 * @param context - Persistent context from the bank-scoped launcher.
 * @returns Resolved context + page pair.
 */
async function persistentContextAndPage(
  context: BrowserContext,
): Promise<{ context: BrowserContext; page: Page }> {
  const existing = context.pages();
  if (existing.length > 0) return { context, page: existing[0] };
  const page = await context.newPage();
  return { context, page };
}

/**
 * Materialise a browser context + first page from the launcher result.
 *
 * Ephemeral path (Browser): creates a fresh context via `newContext`
 * with {@link buildContextOptions}. Persistent path (BrowserContext):
 * the context already exists with context-level options baked in at
 * launch time; we reuse its first page, opening a new one only if
 * none exists yet.
 * @param result - Launcher output (Browser or BrowserContext).
 * @returns Resolved context + page pair.
 */
async function createContextAndPage(
  result: LaunchResult,
): Promise<{ context: BrowserContext; page: Page }> {
  if ('newContext' in result) return ephemeralContextAndPage(result);
  return persistentContextAndPage(result);
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
 * Bundled descriptor of everything `buildBrowserState` / `buildCleanups`
 * need. Bundled because the project's per-function parameter cap is 3.
 */
interface IBuiltBrowserComponents {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly launchResult: LaunchResult;
  readonly bank: string;
}

/**
 * Wrap the launcher's composite close+strip cleanup so it conforms to
 * the `IBrowserState['cleanups']` element shape, which expects
 * `() => Promise<Procedure<void>>` (the pipeline's Procedure-typed
 * status), not the raw `() => Promise<true>` the launcher returns.
 * @param launchResult - Launch result (Browser or BrowserContext).
 * @param bank - Bank identifier driving the strip-cache branch.
 * @returns Pipeline-shaped cleanup callable.
 */
function launchCloseHandler(
  launchResult: LaunchResult,
  bank: string,
): () => Promise<Procedure<void>> {
  const inner = buildCloseAndStripCleanup(launchResult, bank);
  return (): Promise<Procedure<void>> => inner().then((): Procedure<void> => succeed(undefined));
}

/**
 * Build cleanup handlers for browser lifecycle.
 *
 * Ordering — ephemeral path follows the legacy Browser → Context →
 * Page convention. Persistent path skips the duplicate close because
 * `launchResult === context`. The launcher's composite cleanup folds
 * strip-cache inside its own close so the ordered list only carries
 * the resource-close entries.
 * @param components - Page/context/launchResult/bank bundle.
 * @returns Ordered cleanup array.
 */
function buildCleanups(components: IBuiltBrowserComponents): IBrowserState['cleanups'] {
  const { page, context, launchResult, bank } = components;
  const launchCleanup = launchCloseHandler(launchResult, bank);
  if (launchResult === context) {
    return [launchCleanup];
  }
  return [launchCleanup, closeHandler(context), closeHandler(page)];
}

/**
 * Build the browser state from launched components.
 * @param components - Page/context/launchResult/bank bundle.
 * @returns IBrowserState with page, context, and cleanups.
 */
function buildBrowserState(components: IBuiltBrowserComponents): IBrowserState {
  const cleanups = buildCleanups(components);
  return { page: components.page, context: components.context, cleanups };
}

/**
 * Close a launcher result if one was successfully launched.
 *
 * Used by the InitPhase rollback path when a downstream step throws
 * after the browser/context was acquired but before the full
 * IBrowserState was assembled. Tolerant of either union arm.
 *
 * When `bank` is supplied AND the launch succeeded, the strip-aware
 * composite cleanup runs so a persistent-profile `Cache/` /
 * `cache2/` / `OfflineCache/` directory left behind by the partially
 * initialised launch doesn't survive into the next run. Without the
 * bank, falls back to the legacy bare `.close()` so existing
 * unit-test fixtures still drive the no-strip branch.
 * @param launchResult - Launch result or false if not yet launched.
 * @param bank - Optional bank id; enables strip-aware cleanup.
 * @returns True if closed, false if no launch or close failed.
 */
async function closeBrowserSafe(
  launchResult: LaunchResult | false,
  bank?: string,
): Promise<DidLifecycleStep> {
  if (!launchResult) return false as DidLifecycleStep;
  const cleanup = pickRollbackCleanup(launchResult, bank);
  return cleanup()
    .then((): DidLifecycleStep => true as DidLifecycleStep)
    .catch((): DidLifecycleStep => false as DidLifecycleStep);
}

/**
 * Pick the rollback cleanup for `closeBrowserSafe` — the strip-aware
 * composite when a bank is supplied (so persistent-profile launches
 * scrub `Cache/` etc.) or a bare close that resolves true on success.
 * @param launchResult - Live Browser or BrowserContext to close.
 * @param bank - Optional bank id; presence enables strip-cache.
 * @returns Cleanup callable resolving true after close.
 */
function pickRollbackCleanup(launchResult: LaunchResult, bank?: string): () => Promise<true> {
  if (bank === undefined) {
    return async (): Promise<true> => {
      await launchResult.close();
      return true;
    };
  }
  return buildCloseAndStripCleanup(launchResult, bank);
}

export { buildBrowserState, closeBrowserSafe, createContextAndPage, launchBrowser, setupPage };
