/**
 * DASHBOARD phase Mediator actions -- PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * PRE:    locate nav link, cache auth, build API context (NO strategy)
 * ACTION: always click -- physical navigation for every bank
 * POST:   validate traffic delta (change-password check, endpoint count)
 * FINAL:  collect endpoints + auth -> signal to SCRAPE
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { some } from '../../Types/Option.js';
import type {
  IActionContext,
  IApiFetchContext,
  IDashboardState,
  IPipelineContext,
  IResolvedTarget,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { screenshotPath } from '../../Types/RunLabel.js';
import { candidateToSelector, raceResultToTarget } from '../Elements/ActionExecutors.js';
import type { IActionMediator, IElementMediator } from '../Elements/ElementMediator.js';
import {
  buildApiContext,
  countTxnTraffic,
  extractTransactionHref,
  NO_HREF,
  probeSuccessIndicators,
  resolveAbsoluteHref,
  validateTrafficGate,
} from './DashboardDiscovery.js';
import checkChangePassword, { extractAuthFromContext } from './DashboardProbe.js';

/** Human-readable match summary. */
type MatchInfo = string;
/** Dashboard target URL or clickable text for SPA links. */
type TargetUrl = string;
/** Timeout for SPA transaction link probe (15s for Angular SPAs). */
const TRIGGER_PROBE_TIMEOUT = 15000;
/** Timeout for menu settle after toggle click. */
const MENU_SETTLE_MS = 5000;
/** Timeout for post-login redirect settle before probing dashboard. */
const DASHBOARD_SETTLE_MS = 15000;
/** Should force-click for hidden menu toggles. */
const shouldForceMenuClick = true;

/** Screenshot path label. */
type ScreenshotLabel = string;

/**
 * Take dashboard diagnostic screenshot.
 * @param input - Pipeline context with browser.
 * @param label - Screenshot label suffix.
 * @returns True when done.
 */
async function takeDashboardScreenshot(
  input: IPipelineContext,
  label: ScreenshotLabel,
): Promise<true> {
  if (!input.browser.has) return true;
  try {
    const page = input.browser.value.page;
    const path = screenshotPath(input.companyId, label);
    await page.screenshot({ path });
    input.logger.debug({ message: `screenshot: ${path}` });
  } catch {
    /* mock or headless — screenshot not available */
  }
  return true;
}

/**
 * Log the winning dashboard target for diagnostics.
 * @param input - Pipeline context with logger.
 * @param targets - Resolved targets.
 * @returns Description of the winning target.
 */
function logWinningTarget(input: IPipelineContext, targets: IDashboardTargets): MatchInfo {
  if (targets.clickTarget) {
    const t = targets.clickTarget;
    const n = String(targets.clickCandidateCount);
    const head = `WINNER: ${t.kind}="${t.candidateValue}" @ ${t.contextId}`;
    const label: MatchInfo = `${head} (x${n} DOM matches)`;
    input.logger.debug({ message: label });
    return label;
  }
  if (targets.menuTarget) {
    const m = targets.menuTarget;
    const label: MatchInfo = `WINNER (menu): ${m.kind}="${m.candidateValue}" @ ${m.contextId}`;
    input.logger.debug({ message: label });
    return label;
  }
  if (targets.hrefTarget) {
    const label: MatchInfo = `WINNER (href): ${maskVisibleText(targets.hrefTarget)}`;
    input.logger.debug({ message: label });
    return label;
  }
  const label: MatchInfo = 'WINNER: NONE — no target resolved';
  input.logger.debug({ message: label });
  return label;
}

/** Cap on locator.all() expansion — protects against pathological matches
 *  (e.g. a generic text matching dozens of unrelated elements). Beinleumi's
 *  legacy + modern button case needs only 2; cap of 5 leaves headroom. */
const DASHBOARD_MAX_CANDIDATES = 5;

/** Number of DOM matches for the race-winning selector — semantic alias
 *  over `number` to satisfy Rule #15 (no primitive returns). */
type CandidateCount = number;
/** "Did the post-click URL match a transactions-page pattern?" — semantic
 *  alias over `boolean` to satisfy Rule #15. */
type IsTxnPage = boolean;

/** Resolved dashboard targets from PRE -- main trigger + optional menu toggle. */
interface IDashboardTargets {
  /** URL target (from href extraction). */
  readonly hrefTarget: TargetUrl;
  /** Pre-resolved click target (winner of resolveVisible race) — IDENTITY-based
   *  selector that uniquely targets the winning element (HEAD behaviour).
   *  ACTION clicks this FIRST (no nth) so non-ambiguous banks (Isracard,
   *  Discount, etc.) hit the proven winner directly. */
  readonly clickTarget: IResolvedTarget | false;
  /** Generic-selector fallback string + DOM count, used by ACTION ONLY when
   *  the identity click yields no success signal (Beinleumi pm.mataf vs
   *  pm.q077 case: same aria-label, different element). */
  readonly fallbackSelector: TargetUrl;
  /** Number of DOM matches for `fallbackSelector` in the winning frame.
   *  ≥1 when clickTarget set; 0 otherwise. ACTION iterates `.nth(0..count-1)`
   *  of fallbackSelector when identity click failed. */
  readonly clickCandidateCount: number;
  /** Pre-resolved menu toggle target for SEQUENTIAL nav. */
  readonly menuTarget: IResolvedTarget | false;
}

/**
 * Resolve dashboard targets — single race-winner via `resolveVisible` (HEAD
 * behaviour), then count matching DOM elements for that one winning locator.
 * No nth-enum across WK candidates; no cross-WK collection. ACTION owns the
 * iteration over `.nth(0..count-1)` of the SAME selector.
 * @param mediator - Element mediator (full context, read-only probing).
 * @param page - Browser page for contextId computation.
 * @returns Resolved targets for ACTION to click.
 */
async function resolveDashboardTargets(
  mediator: IElementMediator,
  page: Page,
): Promise<IDashboardTargets> {
  const href = await extractTransactionHref(mediator);
  const pageUrl = mediator.getCurrentUrl();
  const hrefTarget = resolveAbsoluteHref(href, pageUrl) || NO_HREF;
  if (hrefTarget) {
    return {
      hrefTarget,
      clickTarget: false,
      fallbackSelector: NO_HREF,
      clickCandidateCount: 0,
      menuTarget: false,
    };
  }
  const txnWk = WK_DASHBOARD.TRANSACTIONS as unknown as readonly SelectorCandidate[];
  const txnResult = await mediator
    .resolveVisible(txnWk, TRIGGER_PROBE_TIMEOUT)
    .catch((): false => false);
  if (!txnResult || !txnResult.locator || !txnResult.candidate || !txnResult.context) {
    return resolveMenuFallback(mediator, page);
  }
  const identityTarget = raceResultToTarget(txnResult, page);
  if (!identityTarget) return resolveMenuFallback(mediator, page);
  // Keep the IDENTITY selector for clickTarget (HEAD behaviour — proven
  // race winner). ACTION clicks this FIRST. Compute the GENERIC selector
  // and DOM count separately so ACTION can iterate `.nth(0..count-1)` only
  // as a fallback when identity click yields no success signal (Beinleumi
  // pm.mataf vs pm.q077: same aria-label but different elements).
  const genericSelector = candidateToSelector(txnResult.candidate);
  const ctx = txnResult.context;
  const fallbackCount: CandidateCount = 1;
  const rawCount = await ctx
    .locator(genericSelector)
    .count()
    .catch((): CandidateCount => fallbackCount);
  const count = Math.min(rawCount, DASHBOARD_MAX_CANDIDATES);
  return {
    hrefTarget: NO_HREF,
    clickTarget: identityTarget,
    fallbackSelector: genericSelector,
    clickCandidateCount: count,
    menuTarget: false,
  };
}

/**
 * Menu expand fallback — last resort when no href or click target.
 * @param mediator - Element mediator.
 * @param page - Browser page.
 * @returns Targets with optional menu toggle.
 */
async function resolveMenuFallback(
  mediator: IElementMediator,
  page: Page,
): Promise<IDashboardTargets> {
  const menuWk = WK_DASHBOARD.MENU_EXPAND as unknown as readonly SelectorCandidate[];
  const menuResult = await mediator
    .resolveVisible(menuWk, TRIGGER_PROBE_TIMEOUT)
    .catch((): false => false);
  const menuTarget = menuResult && raceResultToTarget(menuResult, page);
  return {
    hrefTarget: NO_HREF,
    clickTarget: false,
    fallbackSelector: NO_HREF,
    clickCandidateCount: 0,
    menuTarget,
  };
}

/**
 * Build API context if fetchStrategy available.
 * @param input - Pipeline context.
 * @param network - Network discovery.
 * @returns API context or false.
 */
async function buildApiIfAvailable(
  input: IPipelineContext,
  network: IElementMediator['network'],
): Promise<IApiFetchContext | false> {
  if (!input.fetchStrategy.has) return false;
  const override = {
    baseUrl: input.config.urls.base,
    transactionsPath: input.config.transactionsPath,
  };
  return buildApiContext(network, input.fetchStrategy.value, override).catch((): false => false);
}

/**
 * Dump all visible clickable text on the page for WK forensic discovery.
 * Used when no target found -- logs text so we can add correct WK candidates.
 * @param input - Pipeline context with browser.
 * @returns True after logging.
 */
async function dumpDashboardText(input: IPipelineContext): Promise<true> {
  if (!input.browser.has) return true;
  try {
    const page = input.browser.value.page;
    const sel = 'a, button, [role="tab"], [role="link"], [role="button"]';
    const texts = await page.$$eval(sel, (els: Element[]) => [
      ...new Set(
        els.map(el => (el.textContent || '').trim()).filter(t => t.length > 1 && t.length < 60),
      ),
    ]);
    input.logger.debug({
      message: `VISIBLE CLICKABLE TEXT: [${texts.join(' | ')}]`,
    });
  } catch {
    /* test mock or closed page */
  }
  return true;
}

/** Whether transaction traffic already exists from login redirect. */
type HasExistingTraffic = boolean;

/** Bundled PRE discovery results. */
interface IPreDiscoveryResult {
  readonly matchInfo: MatchInfo;
  readonly targets: IDashboardTargets;
  readonly hasAny: DidNavigate;
  readonly apiCtx: IApiFetchContext | false;
  readonly hasExistingTraffic: HasExistingTraffic;
}

/**
 * Core PRE discovery -- resolve targets. Zero clicks. NO strategy.
 * @param input - Pipeline context.
 * @param mediator - Unwrapped element mediator.
 * @param page - Unwrapped browser page.
 * @returns Discovery bundle.
 */
async function discoverDashboard(
  input: IPipelineContext,
  mediator: IElementMediator,
  page: Page,
): Promise<IPreDiscoveryResult> {
  const network = mediator.network;
  await mediator.waitForNetworkIdle(DASHBOARD_SETTLE_MS).catch((): false => false);
  await network.cacheAuthToken();
  const matchInfo = await probeSuccessIndicators(mediator);
  const targets = await resolveDashboardTargets(mediator, page);
  const hasAny =
    Boolean(targets.hrefTarget) || Boolean(targets.clickTarget) || Boolean(targets.menuTarget);
  const apiCtx = await buildApiIfAvailable(input, network);
  const hasExistingTraffic = countTxnTraffic(network, 0) > 0;
  const authToken = await network.discoverAuthToken();
  const hasAuth = Boolean(authToken);
  const targetDesc = describeTargets(targets);
  input.logger.debug({
    message: `PRE: ${targetDesc}, auth=${String(hasAuth)}, traffic=${String(hasExistingTraffic)}`,
  });
  return { matchInfo, targets, hasAny, apiCtx, hasExistingTraffic };
}

/**
 * PRE: Cache auth, build API context, resolve targets.
 * Zero clicks -- Eye only. Stores IResolvedTarget for ACTION.
 * NO strategy resolution. SCRAPE.PRE decides strategy.
 * @param input - Pipeline context with mediator.
 * @returns Updated context with targets + api.
 */
async function executePreLocateNav(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'DASHBOARD PRE: no mediator');
  if (!input.browser.has) return fail(ScraperErrorTypes.Generic, 'DASHBOARD PRE: no browser');
  await takeDashboardScreenshot(input, 'dashboard-pre');
  const disc = await discoverDashboard(input, input.mediator.value, input.browser.value.page);
  logWinningTarget(input, disc.targets);
  if (!disc.hasAny) {
    await dumpDashboardText(input);
    return fail(ScraperErrorTypes.Generic, 'DASHBOARD PRE: no navigation target found');
  }
  const diag = {
    ...input.diagnostics,
    lastAction: `dashboard-pre (${disc.matchInfo})`,
    dashboardTargetUrl: disc.targets.hrefTarget || NO_HREF,
    dashboardTarget: disc.targets.clickTarget || undefined,
    dashboardFallbackSelector: disc.targets.fallbackSelector || undefined,
    dashboardCandidateCount: disc.targets.clickCandidateCount,
    dashboardMenuTarget: disc.targets.menuTarget || undefined,
    dashboardTrafficExists: disc.hasExistingTraffic,
  };
  if (!disc.apiCtx) return succeed({ ...input, diagnostics: diag });
  return succeed({ ...input, diagnostics: diag, api: some(disc.apiCtx) });
}

/**
 * Build human-readable target description for HANDOFF log.
 * @param targets - Resolved dashboard targets.
 * @returns Description string.
 */
function describeTargets(targets: IDashboardTargets): MatchInfo {
  if (targets.clickTarget) {
    const t = targets.clickTarget;
    const n = String(targets.clickCandidateCount);
    return `target=${t.contextId} > ${maskVisibleText(t.selector)} (DOM matches=${n})`;
  }
  if (targets.menuTarget) {
    const m = targets.menuTarget;
    return `menu=${m.contextId} > ${maskVisibleText(m.selector)}`;
  }
  if (targets.hrefTarget) return `href=${maskVisibleText(targets.hrefTarget)}`;
  return 'target=NONE';
}

/** IActionMediator type alias for sealed helpers. */
type SealedExecutor = IActionMediator;

/** Whether a click/nav succeeded. */
type DidNavigate = boolean;

/**
 * Click a menu toggle via sealed executor (force-click).
 * Best-effort: catch failures, POST validates traffic.
 * @param executor - Sealed action mediator.
 * @param target - Pre-resolved menu target.
 * @param logger - Pipeline logger.
 * @returns True if clicked.
 */
async function executeMenuClick(
  executor: SealedExecutor,
  target: IResolvedTarget,
  logger: IPipelineContext['logger'],
): Promise<DidNavigate> {
  logger.debug({
    strategy: 'MENU',
    result: `${target.contextId} > ${maskVisibleText(target.selector)}`,
  });
  const didClick = await executor
    .clickElement({
      contextId: target.contextId,
      selector: target.selector,
      isForce: shouldForceMenuClick,
    })
    .then((): true => true)
    .catch((): false => false);
  if (!didClick) logger.debug({ message: 'menu click failed' });
  if (didClick) await executor.waitForNetworkIdle(MENU_SETTLE_MS).catch((): false => false);
  return didClick;
}

/**
 * Navigate to an href target via sealed executor.
 * Best-effort: catch failures, POST validates traffic.
 * @param executor - Sealed action mediator.
 * @param href - Target URL.
 * @param logger - Pipeline logger.
 * @returns True if navigated.
 */
async function executeHrefNav(
  executor: SealedExecutor,
  href: TargetUrl,
  logger: IPipelineContext['logger'],
): Promise<DidNavigate> {
  logger.debug({
    strategy: 'NAV',
    result: maskVisibleText(href),
  });
  const didClick = await executor
    .navigateTo(href, { waitUntil: 'domcontentloaded' })
    .then((): true => true)
    .catch((): false => false);
  if (!didClick) logger.debug({ message: 'nav failed -- traffic from login' });
  if (didClick) await executor.waitForNetworkIdle().catch((): false => false);
  return didClick;
}

/**
 * ACTION (sealed): Physical navigation -- best-effort click.
 * Reads `diagnostics.actionAttempt` (set by BasePhase) to pick the
 * candidate from the pre-fetched list. On retry attempts (> 0) restores
 * the dashboard URL via UNDO before clicking the next candidate.
 * Menu fallback fires once (attempt 0); href fallback fires when there's
 * no candidate left to try. POST validates the txn-traffic gate.
 * @param input - Sealed action context with executor + diagnostics targets.
 * @returns Always succeed -- POST is the validator.
 */
async function executeDashboardNavigationSealed(
  input: IActionContext,
): Promise<Procedure<IActionContext>> {
  if (input.diagnostics.dashboardTrafficExists) {
    input.logger.debug({ message: 'traffic exists -- skip click (DIRECT)' });
    return succeed(input);
  }
  if (!input.executor.has) {
    input.logger.debug({ message: 'no executor -- traffic from login' });
    return succeed(input);
  }
  return runCandidateNavigation(input, input.executor.value);
}

/**
 * URL-pattern signal — universal post-click "did we land on the txn page?".
 * Bank-agnostic: works for browser-driven banks (Beinleumi pm.q077 → online.fibi
 * .co.il/.../transactions) AND proxy-fetch banks (Isracard right-click →
 * digital.isracard.co.il/.../Transactions). Driven by `WK_DASHBOARD.TXN_PAGE_PATTERNS`.
 * @param url - Current URL after click.
 * @returns True iff URL matches any known transactions-page pattern.
 */
function isTxnPageUrl(url: string): IsTxnPage {
  return WK_DASHBOARD.TXN_PAGE_PATTERNS.some((pat): IsTxnPage => pat.test(url));
}

/** Force-click flag for candidate clicks (matches existing menu/legacy
 *  pattern; declared as a const so the DI lint rule treats it the same
 *  as `shouldForceMenuClick`). */
const shouldForceCandidateClick = true;

/** Event-driven budget AFTER a URL-pattern match — Angular SPAs (Beinleumi
 *  pm.q077, Discount) navigate to /transactions BEFORE the BFF /transactions/*
 *  XHR fires. Without waiting, walker exits success and SCRAPE.PRE's
 *  autoScrape runs before the txn endpoint is captured. Mediator wraps
 *  Playwright `page.waitForResponse` (event-driven, no polling). */
const POST_MATCH_TXN_WAIT_MS = 4000;

/**
 * Confirm a WK transactions endpoint is captured after a URL-pattern match.
 * On-txn-page → event-driven `waitForTxnEndpoint` (Angular SPA BFF lag).
 * Otherwise → cheap synchronous check via `hasTxnEndpoint`.
 * Logical-lookup form (no ternary) per architecture rules.
 * @param executor - Sealed action mediator.
 * @param isOnTxnPage - Whether the post-click URL matched WK_DASHBOARD.TXN_PAGE_PATTERNS.
 * @returns True iff a txn-shape endpoint is captured by budget end.
 */
async function confirmTxnEndpoint(
  executor: SealedExecutor,
  isOnTxnPage: IsTxnPage,
): Promise<IsTxnPage> {
  if (isOnTxnPage) {
    return executor.waitForTxnEndpoint(POST_MATCH_TXN_WAIT_MS).catch((): false => false);
  }
  return executor.hasTxnEndpoint();
}

/**
 * Candidate navigation — owned ENTIRELY by ACTION (no phase retry).
 *
 * Two-stage strategy that preserves HEAD behaviour for non-ambiguous banks
 * AND adds the smart fallback for Beinleumi-style same-aria-label cases:
 *
 *   STAGE 1 (identity click — HEAD-equivalent):
 *     Click `dashboardTarget` (identity-based selector — proven race winner).
 *     If URL matches TXN_PAGE_PATTERNS or BFF txn endpoint fires → SUCCESS.
 *     This is the FAST PATH for Isracard, Discount, Hapoalim, MAX, VisaCal,
 *     Amex — single click on the proven winner element.
 *
 *   STAGE 2 (generic fallback iteration):
 *     Identity click landed but no txn signal → iterate `dashboardFallback
 *     Selector` `.nth(0..count-1)`. Beinleumi case: pm.mataf (legacy) and
 *     pm.q077 (modern) share aria-label; identity might pick legacy → no
 *     /transactions → goback → iterate to find pm.q077.
 *
 * @param input - Action context.
 * @param executor - Sealed action mediator.
 * @returns Procedure (always succeed; POST is loose any-endpoint gate).
 */
async function runCandidateNavigation(
  input: IActionContext,
  executor: SealedExecutor,
): Promise<Procedure<IActionContext>> {
  const target = input.diagnostics.dashboardTarget;
  const fallbackSelector = input.diagnostics.dashboardFallbackSelector ?? NO_HREF;
  const count = input.diagnostics.dashboardCandidateCount ?? 0;
  const menuTarget = input.diagnostics.dashboardMenuTarget;
  const hrefTarget = input.diagnostics.dashboardTargetUrl;
  if (menuTarget) await executeMenuClick(executor, menuTarget, input.logger);
  if (target) {
    return runIdentityThenFallback({ executor, target, fallbackSelector, count, input });
  }
  if (hrefTarget) await executeHrefNav(executor, hrefTarget, input.logger);
  return succeed(input);
}

/** Bundled args for the two-stage walker — fits 3-param ceiling. */
interface IIterateArgs {
  readonly executor: SealedExecutor;
  readonly target: IResolvedTarget;
  readonly fallbackSelector: string;
  readonly count: number;
  readonly input: IActionContext;
}

/** Bundled args for a single click attempt evaluation. */
interface IClickAttemptArgs {
  readonly executor: SealedExecutor;
  readonly contextId: IResolvedTarget['contextId'];
  readonly selector: string;
  readonly nth?: number;
  readonly attemptLabel: string;
  readonly input: IActionContext;
}

/** Outcome of a single click attempt — success bit + URL before for goback. */
interface IClickOutcome {
  readonly isSuccess: IsTxnPage;
  readonly urlBefore: TargetUrl;
  readonly urlAfter: TargetUrl;
}

/**
 * Execute a click + evaluate post-click txn signal. Single source of truth
 * for the success criteria (URL match OR BFF txn endpoint observable).
 * @param args - Bundled click attempt arguments.
 * @returns Outcome with success bit and url state.
 */
async function evaluateClickAttempt(args: IClickAttemptArgs): Promise<IClickOutcome> {
  const { executor, contextId, selector, nth, attemptLabel, input } = args;
  const urlBefore = executor.getCurrentUrl();
  input.logger.debug({
    strategy: 'CLICK',
    attempt: attemptLabel,
    result: `${contextId} > ${maskVisibleText(selector)}`,
  });
  await executor
    .clickElement({ contextId, selector, isForce: shouldForceCandidateClick, nth })
    .then((): true => true)
    .catch((): false => false);
  await executor.waitForNetworkIdle().catch((): false => false);
  // Two-source success: BFF txn-shape endpoint captured (Beinleumi pm.q077,
  // Discount BFF) OR URL on TXN_PAGE_PATTERNS (Isracard /Transactions, Amex).
  // Angular SPAs navigate to /transactions BEFORE the BFF XHR fires — when
  // URL matches we wait event-driven for the BFF response so SCRAPE.PRE's
  // autoScrape sees the captured endpoint.
  const urlAfter = executor.getCurrentUrl();
  const isOnTxnPage = isTxnPageUrl(urlAfter);
  const isHasTxn = await confirmTxnEndpoint(executor, isOnTxnPage);
  const isSuccess = isHasTxn || isOnTxnPage;
  if (isSuccess) {
    input.logger.debug({
      strategy: 'CLICK',
      attempt: attemptLabel,
      result: `OK — hasTxn=${String(isHasTxn)} url=${urlAfter}`,
    });
  }
  return { isSuccess, urlBefore, urlAfter };
}

/**
 * Restore the page to the pre-click URL when a click navigated somewhere
 * other than the txn page. Used between fallback iteration attempts.
 * @param executor - Sealed action mediator.
 * @param outcome - Click outcome with url before/after.
 * @param logger - Pipeline logger.
 * @returns True after navigation settles (best-effort).
 */
async function restoreUrlIfChanged(
  executor: SealedExecutor,
  outcome: IClickOutcome,
  logger: IActionContext['logger'],
): Promise<true> {
  if (outcome.urlAfter === outcome.urlBefore) return true;
  logger.debug({ message: `goback: ${maskVisibleText(outcome.urlBefore)}` });
  await executor.navigateTo(outcome.urlBefore, { waitUntil: 'load' }).catch((): false => false);
  await executor.waitForNetworkIdle().catch((): false => false);
  return true;
}

/**
 * Two-stage walker entry: identity click first, then iterate fallback nth(0..count-1).
 * @param args - Bundled iteration arguments.
 * @returns Procedure once a click landed on a txn page or all options exhausted.
 */
async function runIdentityThenFallback(args: IIterateArgs): Promise<Procedure<IActionContext>> {
  const { executor, target, fallbackSelector, count, input } = args;
  // STAGE 1: identity click (HEAD behaviour — proven race winner).
  const identityOutcome = await evaluateClickAttempt({
    executor,
    contextId: target.contextId,
    selector: target.selector,
    attemptLabel: 'identity',
    input,
  });
  if (identityOutcome.isSuccess) return succeed(input);
  await restoreUrlIfChanged(executor, identityOutcome, input.logger);
  // STAGE 2: only iterate when there's a meaningful fallback (count > 1
  // implies same selector matches multiple DOM elements — Beinleumi case).
  if (!fallbackSelector || count <= 1) return succeed(input);
  return walkFallbackNth({ executor, target, fallbackSelector, count, input }, 0);
}

/**
 * Iterate `.nth(0..count-1)` of the generic fallback selector when identity
 * click failed. Tail-recursive (no for-loop) to satisfy `no-await-in-loop`.
 * @param args - Bundled iteration arguments.
 * @param i - Current 0-based nth index.
 * @returns Procedure for the action context.
 */
async function walkFallbackNth(args: IIterateArgs, i: number): Promise<Procedure<IActionContext>> {
  const { executor, target, fallbackSelector, count, input } = args;
  if (i >= count) return succeed(input);
  const outcome = await evaluateClickAttempt({
    executor,
    contextId: target.contextId,
    selector: fallbackSelector,
    nth: i,
    attemptLabel: `nth=${String(i)}`,
    input,
  });
  if (outcome.isSuccess) return succeed(input);
  await restoreUrlIfChanged(executor, outcome, input.logger);
  return walkFallbackNth(args, i + 1);
}

/**
 * POST: Change-password check + simple traffic gate (HEAD-equivalent).
 *
 * The "did the click do the right thing?" decision now lives INSIDE
 * dashboard ACTION's candidate-iteration loop (URL-pattern check after
 * each click, goback if mismatch, advance to next DOM element). By POST
 * time, ACTION has already chosen the right candidate or exhausted the
 * list. POST just confirms ANY traffic was hasTxn — same trivial gate
 * HEAD uses.
 *
 * @param input - Pipeline context.
 * @returns Updated context with dashboard state.
 */
async function executeValidateTraffic(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'DASHBOARD POST: no mediator');
  const mediator = input.mediator.value;
  const pwdCheck = await checkChangePassword(mediator);
  if (pwdCheck) return pwdCheck;
  await takeDashboardScreenshot(input, 'dashboard-post');
  const isPrimed = validateTrafficGate(mediator.network, input.logger);
  const pageUrl = mediator.getCurrentUrl();
  input.logger.debug({ primed: isPrimed, url: maskVisibleText(pageUrl) });
  if (!isPrimed) {
    return fail(ScraperErrorTypes.Generic, 'DASHBOARD POST: no API traffic hasTxn');
  }
  const dashState: IDashboardState = {
    isReady: true,
    pageUrl,
    trafficPrimed: isPrimed,
  };
  return succeed({ ...input, dashboard: some(dashState) });
}

/**
 * Build API context from network + fetchStrategy if available.
 * @param input - Pipeline context with mediator + fetchStrategy.
 * @returns Updated context with api populated, or input unchanged.
 */
async function maybeAttachApi(input: IPipelineContext): Promise<IPipelineContext> {
  if (!input.mediator.has) return input;
  if (!input.fetchStrategy.has) return input;
  if (input.api.has) return input;
  const network = input.mediator.value.network;
  await network.cacheAuthToken();
  const override = {
    baseUrl: input.config.urls.base,
    transactionsPath: input.config.transactionsPath,
  };
  const apiCtx = await buildApiContext(network, input.fetchStrategy.value, override);
  return { ...input, api: some(apiCtx) };
}

/**
 * Count hasTxn endpoints from mediator if available.
 * @param ctx - Pipeline context.
 * @returns Endpoint count string.
 */
function countEndpoints(ctx: IPipelineContext): MatchInfo {
  if (!ctx.mediator.has) return '0';
  return String(ctx.mediator.value.network.getAllEndpoints().length);
}

/**
 * FINAL: Build API context + collect auth + endpoints -> signal to SCRAPE.
 * @param input - Pipeline context.
 * @returns Updated context with api + auth in diagnostics.
 */
async function executeCollectAndSignal(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.dashboard.has) return fail(ScraperErrorTypes.Generic, 'DASHBOARD FINAL: not ready');
  const withApi = await maybeAttachApi(input);
  const dashUrl = withApi.dashboard.has && withApi.dashboard.value.pageUrl;
  const discoveredAuth = await extractAuthFromContext(withApi);
  const diag = { ...withApi.diagnostics, finalUrl: some(dashUrl || ''), discoveredAuth };
  const hasAuth = Boolean(discoveredAuth);
  const epCount = countEndpoints(withApi);
  withApi.logger.debug({
    authFound: hasAuth,
    endpoints: epCount,
  });
  return succeed({ ...withApi, diagnostics: diag });
}

export {
  executeCollectAndSignal,
  executeDashboardNavigationSealed,
  executePreLocateNav,
  executeValidateTraffic,
};
