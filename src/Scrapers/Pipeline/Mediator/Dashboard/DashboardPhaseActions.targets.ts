/**
 * Dashboard target resolution for DASHBOARD.PRE.
 *
 * <p>Co-located sibling of {@link "./DashboardPhaseActions.js"} carrying
 * the href / identity-click / menu-fallback resolver chain. Split out
 * so the parent file stays under the LoC cap.
 */

import type { Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import type { IResolvedTarget } from '../../Types/PipelineContext.js';
import { candidateToSelector, raceResultToTarget } from '../Elements/ActionExecutors.js';
import type { IElementMediator, IRaceResult } from '../Elements/ElementMediator.js';
import { DASHBOARD_TRIGGER_PROBE_TIMEOUT_MS } from '../Timing/TimingConfig.js';
import { extractTransactionHref, NO_HREF, resolveAbsoluteHref } from './DashboardDiscovery.js';
import { tryDashboardSequentialNav } from './DashboardPhaseActions.sequential.js';
import type { IDashboardTargets } from './DashboardPhaseActions.targets.types.js';

/** Cap on locator.all() expansion — protects against pathological matches. */
const DASHBOARD_MAX_CANDIDATES = 5;

/** Frame/page context the identity race winner came from. */
type ResolveContext = Exclude<IRaceResult['context'], false>;

/**
 * Build the href-only target shape returned when an href is resolved
 * for the dashboard.
 * @param hrefTarget - Absolute href URL.
 * @returns Dashboard targets carrying only the href.
 */
function buildHrefOnlyTargets(hrefTarget: string): IDashboardTargets {
  return {
    hrefTarget,
    clickTarget: false,
    fallbackSelector: NO_HREF,
    clickCandidateCount: 0,
    menuTarget: false,
  };
}

/**
 * Probe the TXN trigger via mediator with the dashboard timeout,
 * swallowing race errors as `false`.
 * @param mediator - Element mediator.
 * @returns Race result or false on probe error.
 */
async function probeTxnTrigger(mediator: IElementMediator): Promise<IRaceResult | false> {
  const txnWk = WK_DASHBOARD.TRANSACTIONS;
  const result = mediator.resolveVisible(txnWk, DASHBOARD_TRIGGER_PROBE_TIMEOUT_MS);
  return result.catch((): false => false);
}

/**
 * Count generic-selector matches in the winning frame, capped at
 * {@link DASHBOARD_MAX_CANDIDATES}. Failures coerce to `1` so ACTION
 * still has a meaningful identity-click attempt.
 * @param ctx - Winning Page/Frame context.
 * @param genericSelector - Selector to count matches for.
 * @returns Bounded match count.
 */
async function countGenericMatches(ctx: ResolveContext, genericSelector: string): Promise<number> {
  const fallbackCount = 1;
  const rawCount = await ctx
    .locator(genericSelector)
    .count()
    .catch((): number => fallbackCount);
  return Math.min(rawCount, DASHBOARD_MAX_CANDIDATES);
}

/** Bundled inputs for the identity-target builder. */
interface IBuildIdentityTargetArgs {
  readonly txnResult: IRaceResult;
  readonly identityTarget: IResolvedTarget;
  readonly page: Page;
}

/** Bundled inputs for {@link assembleClickTargets}. */
interface IAssembleClickTargetsArgs {
  readonly clickTarget: IResolvedTarget;
  readonly fallbackSelector: string;
  readonly count: number;
}

/**
 * Assemble the IDENTITY-click dashboard targets shape from the
 * resolved click target + generic-selector fallback + match count.
 * @param args - Bundled click target + fallback selector + match count.
 * @returns Dashboard targets carrying the identity click + fallback.
 */
function assembleClickTargets(args: IAssembleClickTargetsArgs): IDashboardTargets {
  return {
    hrefTarget: NO_HREF,
    clickTarget: args.clickTarget,
    fallbackSelector: args.fallbackSelector,
    clickCandidateCount: args.count,
    menuTarget: false,
  };
}

/**
 * Build the identity-click target shape returned when the TXN race
 * winner exposed a candidate + frame context.
 * @param args - Bundled inputs (race result + identity target + page).
 * @returns Dashboard targets carrying the identity click + fallback.
 */
async function buildIdentityTargets(args: IBuildIdentityTargetArgs): Promise<IDashboardTargets> {
  const genericSelector = candidateToSelector(args.txnResult.candidate as SelectorCandidate);
  const ctx = args.txnResult.context as ResolveContext;
  const count = await countGenericMatches(ctx, genericSelector);
  const clickTarget = args.identityTarget;
  return assembleClickTargets({ clickTarget, fallbackSelector: genericSelector, count });
}

/**
 * Race the menu-expand candidates and convert the winner to an
 * IResolvedTarget. Returns `false` when no menu candidate matched.
 * @param mediator - Element mediator.
 * @param page - Browser page (for contextId computation).
 * @returns Menu target or false.
 */
async function probeMenuFallback(
  mediator: IElementMediator,
  page: Page,
): Promise<IResolvedTarget | false> {
  const menuWk = WK_DASHBOARD.MENU_EXPAND as unknown as readonly SelectorCandidate[];
  const menuResult = await mediator
    .resolveVisible(menuWk, DASHBOARD_TRIGGER_PROBE_TIMEOUT_MS)
    .catch((): false => false);
  return menuResult && raceResultToTarget(menuResult, page);
}

/**
 * Build the menu-only dashboard targets shape.
 * @param menuTarget - Resolved menu target (may be false).
 * @returns Dashboard targets with only the menu populated.
 */
function buildMenuOnlyTargets(menuTarget: IResolvedTarget | false): IDashboardTargets {
  return {
    hrefTarget: NO_HREF,
    clickTarget: false,
    fallbackSelector: NO_HREF,
    clickCandidateCount: 0,
    menuTarget,
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
  const menuTarget = await probeMenuFallback(mediator, page);
  return buildMenuOnlyTargets(menuTarget);
}

/**
 * True when the race result carries the trio (locator + candidate +
 * context) the identity-target builder needs.
 * @param r - Race result to validate.
 * @returns True when usable as an identity click.
 */
function isUsableRaceResult(r: IRaceResult): boolean {
  return Boolean(r.locator) && Boolean(r.candidate) && Boolean(r.context);
}

/** Bundled inputs for {@link tryIdentityOrMenu}. */
interface ITryIdentityOrMenuArgs {
  readonly txnResult: IRaceResult;
  readonly mediator: IElementMediator;
  readonly page: Page;
}

/**
 * Try the identity-target branch when the TXN race winner is usable.
 * Returns the menu fallback when the race result lacks fields or the
 * identity target cannot be built.
 * @param args - Bundled race result + page + mediator.
 * @returns Identity-click targets, or menu fallback when unusable.
 */
async function tryIdentityOrMenu(args: ITryIdentityOrMenuArgs): Promise<IDashboardTargets> {
  const identityTarget = raceResultToTarget(args.txnResult, args.page);
  if (!identityTarget) return resolveMenuFallback(args.mediator, args.page);
  return buildIdentityTargets({ txnResult: args.txnResult, identityTarget, page: args.page });
}

/**
 * Resolve the click-or-menu side of the dashboard target picker: TXN
 * trigger race → identity target build → menu fallback. No href here.
 * @param mediator - Element mediator.
 * @param page - Browser page.
 * @returns Dashboard targets carrying the click+fallback or menu fallback.
 */
async function resolveClickOrMenu(
  mediator: IElementMediator,
  page: Page,
): Promise<IDashboardTargets> {
  const txnResult = await probeTxnTrigger(mediator);
  if (txnResult === false) return resolveMenuFallback(mediator, page);
  if (!isUsableRaceResult(txnResult)) return resolveMenuFallback(mediator, page);
  return tryIdentityOrMenu({ txnResult, mediator, page });
}

/**
 * Resolve the href-first dashboard target — extract a transactions
 * href, absolute-ify it, return `NO_HREF` when nothing resolved.
 * @param mediator - Element mediator.
 * @returns Absolute href or NO_HREF.
 */
async function resolveHrefTarget(mediator: IElementMediator): Promise<string> {
  const href = await extractTransactionHref(mediator);
  const pageUrl = mediator.getCurrentUrl();
  return resolveAbsoluteHref(href, pageUrl) || NO_HREF;
}

/**
 * Resolve dashboard targets — SEQUENTIAL probe → href → click/menu.
 * @param mediator - Element mediator (full context, read-only probing).
 * @param page - Browser page for contextId computation.
 * @returns Resolved targets for ACTION to click.
 */
async function resolveDashboardTargets(
  mediator: IElementMediator,
  page: Page,
): Promise<IDashboardTargets> {
  const sequentialTargets = await tryDashboardSequentialNav(page);
  if (sequentialTargets) return sequentialTargets;
  const hrefTarget = await resolveHrefTarget(mediator);
  if (hrefTarget) return buildHrefOnlyTargets(hrefTarget);
  return resolveClickOrMenu(mediator, page);
}

export default resolveDashboardTargets;
export { resolveDashboardTargets };
