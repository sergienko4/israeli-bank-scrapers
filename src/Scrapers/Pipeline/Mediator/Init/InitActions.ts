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
 * Storage-clearing init script body. Passed to `addInitScript` as
 * a literal string so it runs in the browser-context closure
 * BEFORE any site scripts (Playwright IPC-serialises and injects
 * it). Storing the body as a string instead of a function expr
 * keeps Node-side coverage instrumentation OFF the unreachable
 * browser code (Node never executes this body — only Camoufox /
 * Firefox does, after the page navigates to the bank).
 *
 * <p>Each clear is wrapped in try/catch — some origins (e.g.
 * `data:` pages before first navigation) throw SecurityError
 * when storage APIs are read, and we want the hook to be
 * best-effort. The IndexedDB clear is async; we don't await it
 * here because the script returns synchronously and the deletes
 * race against page-script storage writes regardless.
 */
const COLD_START_STORAGE_CLEAR = `
  try { localStorage.clear(); } catch (e) { /* best-effort */ }
  try { sessionStorage.clear(); } catch (e) { /* best-effort */ }
  try {
    indexedDB.databases().then(function (dbs) {
      dbs.forEach(function (db) {
        if (db.name) indexedDB.deleteDatabase(db.name);
      });
    }).catch(function () { /* best-effort */ });
  } catch (e) { /* best-effort */ }
`;

/**
 * Cold-Start protocol — when DUMP_SNAPSHOTS=1, strip every client-
 * side recognition signal so device-remembered banks (Hapoalim)
 * present the full OTP challenge.
 *
 * <p>Round 4 (PR #215) extended the protocol from cookies-only to
 * full storage clearing after empirical CI evidence (run
 * 25588938082) showed `clearCookies` alone is insufficient to force
 * the OTP path on Hapoalim. Suspected channels:
 *  - HTTP cookies (already cleared via `clearCookies`).
 *  - localStorage / sessionStorage (now cleared via init script).
 *  - IndexedDB (now cleared via init script — best-effort, async).
 *  - Permissions (now cleared).
 *  - **IP address** — bank-side recognition by source IP. NOT
 *    addressable from the browser side. CI runners get fresh IPs
 *    per run, so the OTP path always engages there. Local
 *    developer boxes from a stable IP may still be device-
 *    remembered after a recent successful login. This is a
 *    bank-side signal and the cold-start cannot override it.
 *
 * <p>Used for capturing high-fidelity HTML snapshots
 * (`otp-fill.html` with PIN inputs visible) AND for forcing the
 * full OTP flow when validating round-4 changes locally.
 *
 * @param context - Browser context to sanitise.
 * @returns True when DUMP_SNAPSHOTS was active and the protocol
 *   ran; false when the dump flag was off and the call was a no-op.
 */
async function coldStartIfDumping(context: BrowserContext): Promise<boolean> {
  const isDumping = process.env.DUMP_SNAPSHOTS === '1' || process.env.DUMP_SNAPSHOTS === 'true';
  if (!isDumping) return false;
  await context.clearCookies().catch((): false => false);
  await context.clearPermissions().catch((): false => false);
  await context.addInitScript({ content: COLD_START_STORAGE_CLEAR }).catch((): false => false);
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
// Internal helper exposed only for focused unit tests. Do NOT import
// outside of `src/Tests/Unit/**`. Safe to change without deprecation.
export { coldStartIfDumping };
