/**
 * HOME phase Mediator actions — locate, click, validate, signal.
 * Phase orchestrates ONLY. All logic here.
 * Uses ONLY WK_HOME. Never imports from PreLoginWK or LoginWK.
 */

import type { Locator, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { WK_HOME } from '../../Registry/WK/HomeWK.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';

/** Whether a login link was found. */
type DidFind = boolean;
/** Discovered login URL from navigation or iframe. */
type LoginUrlStr = string;
/** Number of frames on the page. */
type FrameCount = number;

/** Login path patterns — common across Israeli banks. */
const LOGIN_PATH_PATTERNS = [/personalarea\/login/i, /login/i, /auth/i];

/** Timeout for waiting for login link. */
const ENTRY_TIMEOUT = 15000;

/** Timeout for settle after click. */
const SETTLE_TIMEOUT = 15000;

/**
 * PRE: Locate login nav link via WK_HOME.ENTRY.
 * If not found → fail (ACTION should not run).
 * @param mediator - Element mediator.
 * @param logger - Pipeline logger.
 * @returns Procedure with IRaceResult (found element info).
 */
async function executeLocateLoginNav(
  mediator: IElementMediator,
  logger: ScraperLogger,
): Promise<Procedure<IRaceResult>> {
  const candidates = WK_HOME.ENTRY as unknown as readonly SelectorCandidate[];
  const visible = await mediator
    .resolveVisible(candidates, ENTRY_TIMEOUT)
    .catch((): false => false);
  if (!visible || !visible.found) {
    return fail(ScraperErrorTypes.Generic, 'HOME PRE: no login nav link found');
  }
  logger.debug({ event: 'element-found', phase: 'home', text: maskVisibleText(visible.value) });
  return succeed(visible);
}

/**
 * ACTION: Click the login entry link. Wait for navigation OR iframe.
 * Scans for login href as fallback if click doesn't navigate.
 * @param mediator - Element mediator.
 * @param input - Pipeline context with browser.
 * @param logger - Pipeline logger.
 * @returns Procedure with updated context.
 */
async function executeNavigateToLogin(
  mediator: IElementMediator,
  input: IPipelineContext,
  logger: ScraperLogger,
): Promise<Procedure<IPipelineContext>> {
  const urlBefore = mediator.getCurrentUrl();
  // Click WK entry link
  const clickResult = await mediator.resolveAndClick(
    WK_HOME.ENTRY as unknown as readonly SelectorCandidate[],
  );
  if (clickResult.success && clickResult.value.found) {
    const label = clickResult.value.value;
    logger.debug({ event: 'element-found', phase: 'home', text: maskVisibleText(label) });
  }
  // Wait for navigation or iframe to settle
  await mediator.waitForNetworkIdle(SETTLE_TIMEOUT).catch((): false => false);
  const urlAfter = mediator.getCurrentUrl();
  const didNavigate = urlBefore !== urlAfter;
  logger.debug({ event: 'navigation', phase: 'home', url: maskVisibleText(urlAfter), didNavigate });
  // If click didn't navigate, scan for login href and navigate directly
  if (!didNavigate) await tryFallbackNavigation(mediator, logger);
  const finalUrl = mediator.getCurrentUrl();
  logger.trace({
    event: 'navigation',
    phase: 'home',
    url: maskVisibleText(finalUrl),
    didNavigate: urlBefore !== finalUrl,
  });
  return succeed(input);
}

/**
 * Scan all hrefs on the page for a login URL pattern.
 * @param mediator - Element mediator.
 * @returns First matching login href or false.
 */
async function findLoginHrefOnPage(mediator: IElementMediator): Promise<LoginUrlStr | false> {
  const allHrefs = await mediator.collectAllHrefs();
  const match = allHrefs.find((h): DidFind => LOGIN_PATH_PATTERNS.some((p): DidFind => p.test(h)));
  return match ?? false;
}

/**
 * Fallback: scan page for login href and navigate directly.
 * @param mediator - Element mediator.
 * @param logger - Pipeline logger.
 * @returns True if navigated, false otherwise.
 */
async function tryFallbackNavigation(
  mediator: IElementMediator,
  logger: ScraperLogger,
): Promise<DidFind> {
  const loginHref = await findLoginHrefOnPage(mediator);
  if (!loginHref) return false;
  logger.debug({ event: 'navigation-fallback', phase: 'home', url: maskVisibleText(loginHref) });
  const navOpts = { waitUntil: 'domcontentloaded' as const };
  await mediator.navigateTo(loginHref, navOpts).catch((): false => false);
  return true;
}

/** Bundled args for login area validation. */
interface IValidateLoginAreaArgs {
  readonly mediator: IElementMediator;
  readonly input: IPipelineContext;
  readonly homepageUrl: LoginUrlStr;
  readonly logger: ScraperLogger;
}

/**
 * POST: Validate URL changed from homepage OR login iframe appeared.
 * @param args - Bundled validation arguments.
 * @returns Succeed if login area detected, fail otherwise.
 */
async function executeValidateLoginArea(
  args: IValidateLoginAreaArgs,
): Promise<Procedure<IPipelineContext>> {
  const { mediator, input, homepageUrl, logger } = args;
  const currentUrl = mediator.getCurrentUrl();
  const didNavigate = currentUrl !== homepageUrl;
  let frameCount: FrameCount = 0;
  if (input.browser.has) frameCount = input.browser.value.page.frames().length;
  const hasFrames = frameCount > 1;
  // Check for login form fields in any frame
  const formGate = WK_HOME.FORM_CHECK as unknown as readonly SelectorCandidate[];
  const formProbe = await mediator
    .resolveVisible(formGate, ENTRY_TIMEOUT)
    .catch((): false => false);
  const hasLoginForm: DidFind = formProbe !== false && formProbe.found;
  logger.debug({
    event: 'home-validate',
    didNavigate,
    frames: frameCount,
    loginForm: hasLoginForm,
  });
  // Success if: navigated to different URL, OR iframe appeared, OR login form found
  if (didNavigate || hasFrames || hasLoginForm) return succeed(input);
  return fail(ScraperErrorTypes.Generic, 'HOME POST: login area not detected');
}

/**
 * FINAL: Store validated loginUrl in diagnostics → signal to PRE-LOGIN.
 * @param mediator - Element mediator.
 * @param input - Pipeline context.
 * @param logger - Pipeline logger.
 * @returns Updated context with loginUrl in diagnostics.
 */
function executeStoreLoginSignal(
  mediator: IElementMediator,
  input: IPipelineContext,
  logger: ScraperLogger,
): Procedure<IPipelineContext> {
  const loginUrl = mediator.getCurrentUrl();
  const diag = { ...input.diagnostics, loginUrl };
  logger.debug({
    event: 'navigation',
    phase: 'home',
    url: maskVisibleText(loginUrl),
    didNavigate: true,
  });
  return succeed({ ...input, diagnostics: diag });
}

// ── Legacy compat — old tests import these names ──

/**
 * Legacy: click login link via WK_HOME.ENTRY.
 * @param mediator - Element mediator.
 * @returns Procedure with IRaceResult.
 */
async function tryClickLoginLink(mediator: IElementMediator): Promise<Procedure<IRaceResult>> {
  return mediator.resolveAndClick(WK_HOME.ENTRY as unknown as readonly SelectorCandidate[]);
}

/**
 * Legacy: wait for any WK login link to become visible.
 * @param browserPage - Browser page.
 * @returns True if any login link visible.
 */
async function waitForAnyLoginLink(browserPage: Page): Promise<DidFind> {
  const candidates = WK_HOME.ENTRY;
  const locators = candidates.map((c): Locator => browserPage.getByText(c.value).first());
  const waiters = locators.map(async (loc, i): Promise<number> => {
    await loc.waitFor({ state: 'visible', timeout: ENTRY_TIMEOUT });
    return i;
  });
  const results = await Promise.allSettled(waiters);
  return results.some((r): DidFind => r.status === 'fulfilled');
}

export {
  executeLocateLoginNav,
  executeNavigateToLogin,
  executeStoreLoginSignal,
  executeValidateLoginArea,
  tryClickLoginLink,
  waitForAnyLoginLink,
};
