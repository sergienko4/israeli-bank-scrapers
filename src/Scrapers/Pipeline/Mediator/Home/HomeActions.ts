/**
 * HOME phase Mediator actions — navigate, validate, signal.
 * Phase orchestrates ONLY. All logic here.
 * Uses ONLY WK_HOME. Never imports from PreLoginWK or LoginWK.
 *
 * Rule #20: PRE is passive (HomeResolver.ts). ACTION is the Executioner.
 * Supports DIRECT (single click) and SEQUENTIAL (menu toggle + child click).
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
import type { IHomeDiscovery } from './HomeResolver.js';

/** Whether a login link was found. */
type DidFind = boolean;
/** Discovered login URL from navigation or iframe. */
type LoginUrlStr = string;
/** Number of frames on the page. */
type FrameCount = number;

/** Login path patterns — common across Israeli banks. */
const LOGIN_PATH_PATTERNS = [/personalarea\/login/i, /login/i, /auth/i];

/** Timeout for settle after click. */
const SETTLE_TIMEOUT = 15000;

/** Timeout for waiting for login link in POST. */
const ENTRY_TIMEOUT = 15000;

/** Timeout for menu child visibility after dropdown open. */
const MENU_WAIT_MS = 5000;

/** Timeout for SPA URL change after menu click. */
const SPA_NAV_TIMEOUT = 10000;

/** Bundled args for navigation execution. */
interface INavExecArgs {
  readonly mediator: IElementMediator;
  readonly input: IPipelineContext;
  readonly discovery: IHomeDiscovery;
  readonly logger: ScraperLogger;
}

/**
 * ACTION: Navigate to login page using discovery from PRE.
 * DIRECT: single click → wait. SEQUENTIAL: click trigger → find menu child → click → wait.
 * Falls back to href scan if navigation doesn't occur.
 * @param args - Bundled navigation arguments.
 * @returns Procedure with updated context.
 */
async function executeNavigateToLogin(args: INavExecArgs): Promise<Procedure<IPipelineContext>> {
  const { mediator, discovery, logger } = args;
  const urlBefore = mediator.getCurrentUrl();
  const isSequential = discovery.strategy === 'SEQUENTIAL';
  if (isSequential) {
    await executeSequentialNav(mediator, discovery, logger);
  }
  if (!isSequential) {
    await executeDirectNav(mediator, discovery, logger);
  }
  await mediator.waitForNetworkIdle(SETTLE_TIMEOUT).catch((): false => false);
  const urlAfter = mediator.getCurrentUrl();
  const didNavigate = urlBefore !== urlAfter;
  const maskedUrl = maskVisibleText(urlAfter);
  logger.debug({ event: 'navigation', phase: 'home', url: maskedUrl, didNavigate });
  if (!didNavigate) await tryFallbackNavigation(mediator, logger);
  const finalUrl = mediator.getCurrentUrl();
  logger.trace({
    event: 'navigation',
    phase: 'home',
    url: maskVisibleText(finalUrl),
    didNavigate: urlBefore !== finalUrl,
  });
  return succeed(args.input);
}

/**
 * Execute DIRECT navigation — single click on trigger text.
 * @param mediator - Element mediator.
 * @param discovery - Discovery with triggerText.
 * @param logger - Pipeline logger.
 * @returns True if clicked.
 */
async function executeDirectNav(
  mediator: IElementMediator,
  discovery: IHomeDiscovery,
  logger: ScraperLogger,
): Promise<DidFind> {
  const candidate: SelectorCandidate = { kind: 'textContent', value: discovery.triggerText };
  const result = await mediator.resolveAndClick([candidate]).catch((): false => false);
  if (!result || !result.success || !result.value.found) return false;
  const label = result.value.value;
  logger.debug({ event: 'element-found', phase: 'home', text: maskVisibleText(label) });
  return true;
}

/**
 * Execute SEQUENTIAL navigation — click trigger (menu), wait, click child.
 * @param mediator - Element mediator.
 * @param discovery - Discovery with triggerText + menuCandidates.
 * @param logger - Pipeline logger.
 * @returns True if target clicked.
 */
async function executeSequentialNav(
  mediator: IElementMediator,
  discovery: IHomeDiscovery,
  logger: ScraperLogger,
): Promise<DidFind> {
  // Step 1: Click trigger (open menu)
  const triggerCandidate: SelectorCandidate = { kind: 'textContent', value: discovery.triggerText };
  await mediator.resolveAndClick([triggerCandidate]).catch((): false => false);
  logger.debug({
    event: 'element-found',
    phase: 'home',
    text: maskVisibleText(discovery.triggerText),
  });
  // Step 2: Wait for menu child to become visible
  await mediator.waitForNetworkIdle(MENU_WAIT_MS).catch((): false => false);
  // Step 3: Click the menu child
  if (discovery.menuCandidates.length === 0) return false;
  const candidates = discovery.menuCandidates;
  const menuResult = await mediator.resolveAndClick(candidates).catch((): false => false);
  if (!menuResult || !menuResult.success || !menuResult.value.found) return false;
  const targetText = menuResult.value.value;
  const maskedTrigger = maskVisibleText(discovery.triggerText);
  const maskedTarget = maskVisibleText(targetText);
  logger.debug({ event: 'home-nav-sequence', trigger: maskedTrigger, target: maskedTarget });
  // Step 4: SPA wait — wait for URL to contain /login (Angular routing delay)
  await mediator.waitForURL('**/login**', SPA_NAV_TIMEOUT);
  return true;
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
  executeNavigateToLogin,
  executeStoreLoginSignal,
  executeValidateLoginArea,
  tryClickLoginLink,
  waitForAnyLoginLink,
};
