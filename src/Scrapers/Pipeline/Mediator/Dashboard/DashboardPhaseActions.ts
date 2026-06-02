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
import { PIPELINE_WELL_KNOWN_API } from '../../Registry/WK/ScrapeWK.js';
import type { ITxnEndpointInternal } from '../../Types/Domain/TxnEndpointTypes.js';
import type { IDashboardTxnHarvest } from '../../Types/Domain/TxnHarvestTypes.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { some } from '../../Types/Option.js';
import type {
  IActionContext,
  IApiFetchContext,
  IDashboardState,
  IPipelineContext,
  IResolvedTarget,
} from '../../Types/PipelineContext.js';
import { EMPTY_TXN_HARVEST } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { candidateToSelector, raceResultToTarget } from '../Elements/ActionExecutors.js';
import type {
  IActionMediator,
  IElementMediator,
  IRaceResult,
} from '../Elements/ElementMediator.js';
import type { INetworkDiscovery } from '../Network/NetworkDiscoveryTypes.js';
import { resolveTxnEndpoint } from '../Scrape/ScrapeAutoMapper.js';
import { EMPTY_TXN_ENDPOINT } from '../Scrape/ScrapePhaseActions.js';
import {
  DASHBOARD_FINAL_TXN_WAIT_MS,
  DASHBOARD_MENU_SETTLE_MS,
  DASHBOARD_POST_MATCH_TXN_WAIT_MS,
  DASHBOARD_SETTLE_MS,
  DASHBOARD_TRIGGER_PROBE_TIMEOUT_MS,
} from '../Timing/TimingConfig.js';
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
import detectDormantEvidence from './DormantEvidenceDetector.js';
import { buildTxnHarvest } from './TxnParser.js';

/** Should force-click for hidden menu toggles. */
const shouldForceMenuClick = true;

/**
 * Convert the click-at sentinel (`number | false`) to a numeric value
 * suitable for logging. Returns 0 when no click was dispatched. Pulled
 * out so the structured log fields stay free of ternaries.
 * @param clickAt - The raw click-at value.
 * @returns Click timestamp in ms, or 0 when absent.
 */
function clickAtForLog(clickAt: number | false): number {
  if (clickAt === false) return 0;
  return clickAt;
}

/** Sentinel label emitted when no PRE-resolved target was found. */
const NO_WINNER_LABEL = 'WINNER: NONE — no target resolved';

/**
 * Build the winner label for an identity click target.
 * @param clickTarget - PRE-resolved click target.
 * @param count - Generic-selector DOM match count.
 * @returns Human-readable WINNER line.
 */
function winnerLabelClick(clickTarget: IResolvedTarget, count: number): string {
  const { kind, candidateValue, contextId } = clickTarget;
  const head = `WINNER: ${kind}="${candidateValue}" @ ${contextId}`;
  return `${head} (x${String(count)} DOM matches)`;
}

/**
 * Build the winner label for a menu-toggle target.
 * @param menuTarget - PRE-resolved menu target.
 * @returns Human-readable WINNER line.
 */
function winnerLabelMenu(menuTarget: IResolvedTarget): string {
  const { kind, candidateValue, contextId } = menuTarget;
  return `WINNER (menu): ${kind}="${candidateValue}" @ ${contextId}`;
}

/**
 * Build the winner label for an href target.
 * @param hrefTarget - Resolved href URL.
 * @returns Human-readable WINNER line.
 */
function winnerLabelHref(hrefTarget: string): string {
  return `WINNER (href): ${maskVisibleText(hrefTarget)}`;
}

/**
 * Build the winner-target label from the PRE-resolved targets bundle.
 * Picks the first present target in click → menu → href priority order.
 * @param targets - Resolved dashboard targets.
 * @returns Label string (NO_WINNER_LABEL when nothing matched).
 */
function buildWinnerLabel(targets: IDashboardTargets): string {
  const { clickTarget, menuTarget, hrefTarget, clickCandidateCount } = targets;
  if (clickTarget) return winnerLabelClick(clickTarget, clickCandidateCount);
  if (menuTarget) return winnerLabelMenu(menuTarget);
  if (hrefTarget) return winnerLabelHref(hrefTarget);
  return NO_WINNER_LABEL;
}

/**
 * Log the winning dashboard target for diagnostics.
 * @param input - Pipeline context with logger.
 * @param targets - Resolved targets.
 * @returns Description of the winning target.
 */
function logWinningTarget(input: IPipelineContext, targets: IDashboardTargets): string {
  const label = buildWinnerLabel(targets);
  input.logger.debug({ message: label });
  return label;
}

/** Cap on locator.all() expansion — protects against pathological matches
 *  (e.g. a generic text matching dozens of unrelated elements). Beinleumi's
 *  legacy + modern button case needs only 2; cap of 5 leaves headroom. */
const DASHBOARD_MAX_CANDIDATES = 5;

/** Resolved dashboard targets from PRE -- main trigger + optional menu toggle. */
interface IDashboardTargets {
  /** URL target (from href extraction). */
  readonly hrefTarget: string;
  /** Pre-resolved click target (winner of resolveVisible race) — IDENTITY-based
   *  selector that uniquely targets the winning element (HEAD behaviour).
   *  ACTION clicks this FIRST (no nth) so non-ambiguous banks (Isracard,
   *  Discount, etc.) hit the proven winner directly. */
  readonly clickTarget: IResolvedTarget | false;
  /** Generic-selector fallback string + DOM count, used by ACTION ONLY when
   *  the identity click yields no success signal (Beinleumi pm.mataf vs
   *  pm.q077 case: same aria-label, different element). */
  readonly fallbackSelector: string;
  /** Number of DOM matches for `fallbackSelector` in the winning frame.
   *  ≥1 when clickTarget set; 0 otherwise. ACTION iterates `.nth(0..count-1)`
   *  of fallbackSelector when identity click failed. */
  readonly clickCandidateCount: number;
  /** Pre-resolved menu toggle target for SEQUENTIAL nav. */
  readonly menuTarget: IResolvedTarget | false;
}

/** Frame/page context the identity race winner came from. */
type ResolveContext = Exclude<IRaceResult['context'], false>;

/**
 * Build the href-only target shape returned when an href is resolved
 * for the dashboard. Used by {@link resolveDashboardTargets} to keep
 * the parent body short.
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
  const txnWk = WK_DASHBOARD.TRANSACTIONS as unknown as readonly SelectorCandidate[];
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

/**
 * Assemble the IDENTITY-click dashboard targets shape from the
 * resolved click target + generic-selector fallback + match count.
 * Pulled out so {@link buildIdentityTargets} stays under the LoC cap.
 * @param clickTarget - PRE-resolved IDENTITY click target.
 * @param fallbackSelector - Generic selector for nth-iteration fallback.
 * @param count - Bounded DOM-match count for the fallback selector.
 * @returns Dashboard targets carrying the identity click + fallback.
 */
function assembleClickTargets(
  clickTarget: IResolvedTarget,
  fallbackSelector: string,
  count: number,
): IDashboardTargets {
  return {
    hrefTarget: NO_HREF,
    clickTarget,
    fallbackSelector,
    clickCandidateCount: count,
    menuTarget: false,
  };
}

/**
 * Build the identity-click target shape returned when the TXN race
 * winner exposed a candidate + frame context. Counts generic-selector
 * fallbacks so ACTION can iterate `.nth(0..count-1)` if needed.
 * @param args - Bundled inputs (race result + identity target + page).
 * @returns Dashboard targets carrying the identity click + fallback.
 */
async function buildIdentityTargets(args: IBuildIdentityTargetArgs): Promise<IDashboardTargets> {
  const genericSelector = candidateToSelector(args.txnResult.candidate as SelectorCandidate);
  const ctx = args.txnResult.context as ResolveContext;
  const count = await countGenericMatches(ctx, genericSelector);
  return assembleClickTargets(args.identityTarget, genericSelector, count);
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
  if (!txnResult.locator || !txnResult.candidate || !txnResult.context) {
    return resolveMenuFallback(mediator, page);
  }
  const identityTarget = raceResultToTarget(txnResult, page);
  if (!identityTarget) return resolveMenuFallback(mediator, page);
  return buildIdentityTargets({ txnResult, identityTarget, page });
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
  const sequentialTargets = await tryDashboardSequentialNav(page);
  if (sequentialTargets) return sequentialTargets;
  const hrefTarget = await resolveHrefTarget(mediator);
  if (hrefTarget) return buildHrefOnlyTargets(hrefTarget);
  return resolveClickOrMenu(mediator, page);
}

/** Main-frame context identifier — matches FrameRegistry.MAIN_CONTEXT_ID. */
const MAIN_CONTEXT_ID = 'main';
/**
 * Angular `dropdowntoggle` directive — the deterministic structural signal
 * for a real dropdown-toggle. Always present when the directive is bound,
 * unlike `role="button"` which Angular hydrates inconsistently across
 * runs. Cross-bank-validated Max-only via
 * scripts/validate-trigger-v3.local.ts (only Max's dashboard renders
 * `[dropdowntoggle]`; all other 6 banks have zero matches).
 */
const DROPDOWN_TOGGLE_ARIA_FILTER = '[dropdowntoggle]';

/**
 * Defensive wrapper around `page.getByText(...).count()` — sync exceptions
 * thrown by mock pages (no `getByText` method) coerce to a 0 count instead
 * of crashing the SEQUENTIAL probe.
 * @param page - Browser page.
 * @param value - Exact-text value to count.
 * @returns DOM match count (0 on error).
 */
async function safeProbeExactTextCount(page: Page, value: string): Promise<number> {
  try {
    return await page.getByText(value, { exact: true }).count();
  } catch {
    return 0;
  }
}

/**
 * Find the first exactText candidate from WK_TRANSACTIONS that has at least
 * one DOM match on the current page. Used as the SEQUENTIAL-fire signal —
 * exactText entries are bank-specific disambiguators (e.g., Max's
 * "פירוט החיובים והעסקאות" with definite articles, validated to be
 * Max-only via scripts/validate-max-sequential-v2.local.ts).
 *
 * Cross-bank-safe because the other 6 banks' dashboard HTML contains zero
 * matches for any exactText we add to TRANSACTIONS.
 * @param page - Browser page.
 * @param candidates - WK_TRANSACTIONS list.
 * @returns First exactText candidate present in DOM, or false.
 */
async function findFirstChildInDom(
  page: Page,
  candidates: readonly SelectorCandidate[],
): Promise<SelectorCandidate | false> {
  const probes = candidates.map((c): Promise<number> => {
    if (c.kind !== 'exactText') return Promise.resolve(0);
    return safeProbeExactTextCount(page, c.value);
  });
  const counts = await Promise.all(probes);
  const idx = counts.findIndex((n): boolean => n >= 1);
  if (idx < 0) return false;
  return candidates[idx];
}

/**
 * Defensive wrapper around `page.locator([dropdowntoggle]).filter().count()`
 * — sync exceptions thrown by mock pages coerce to a 0 count instead of
 * crashing the SEQUENTIAL probe.
 * @param page - Browser page.
 * @param value - hasText value to filter by.
 * @returns DOM match count (0 on error).
 */
async function safeProbeDropdownToggleCount(page: Page, value: string): Promise<number> {
  try {
    return await page.locator(DROPDOWN_TOGGLE_ARIA_FILTER).filter({ hasText: value }).count();
  } catch {
    return 0;
  }
}

/**
 * Find the first WK_MENU_EXPAND text candidate that uniquely matches a
 * dropdown-toggle on the page (Angular `dropdowntoggle` directive filter).
 *
 * Generic mediator.resolveVisible(MENU_EXPAND) is too loose — its race
 * picks any element with the candidate text, including `role="heading"`
 * sub-labels and `role="link"` hamburger menus. The directive filter
 * narrows to elements that actually toggle dropdowns.
 *
 * @param page - Browser page.
 * @param candidates - WK_MENU_EXPAND list.
 * @returns First matching candidate text, or false.
 */
async function findDropdownToggleCandidate(
  page: Page,
  candidates: readonly SelectorCandidate[],
): Promise<SelectorCandidate | false> {
  const probes = candidates.map((c): Promise<number> => {
    if (c.kind !== 'textContent' && c.kind !== 'exactText') return Promise.resolve(0);
    return safeProbeDropdownToggleCount(page, c.value);
  });
  const counts = await Promise.all(probes);
  const idx = counts.indexOf(1);
  if (idx < 0) return false;
  return candidates[idx];
}

/**
 * Build a selector that targets the dropdown-toggle uniquely:
 *   `[dropdowntoggle]:has-text("<value>")`
 * Combines the WK candidate text with the Angular directive filter.
 * @param value - Visible text of the dropdown-toggle.
 * @returns Playwright-compatible selector string.
 */
function buildDropdownToggleSelector(value: string): string {
  return DROPDOWN_TOGGLE_ARIA_FILTER + ':has-text("' + value + '")';
}

/**
 * Build the menu trigger `IResolvedTarget` for the SEQUENTIAL menu →
 * child chain. Pulled out to keep
 * {@link tryDashboardSequentialNav} terse.
 * @param triggerCandidate - Menu-expand candidate text.
 * @returns Menu IResolvedTarget targeting the dropdown-toggle.
 */
function buildSequentialMenuTarget(triggerCandidate: SelectorCandidate): IResolvedTarget {
  return {
    selector: buildDropdownToggleSelector(triggerCandidate.value),
    contextId: MAIN_CONTEXT_ID,
    kind: 'css',
    candidateValue: triggerCandidate.value,
  };
}

/**
 * Build the child-click `IResolvedTarget` for the SEQUENTIAL chain.
 * @param childCandidate - Selector candidate for the child link.
 * @returns IResolvedTarget for the child click.
 */
function buildSequentialChildTarget(childCandidate: SelectorCandidate): IResolvedTarget {
  return {
    selector: candidateToSelector(childCandidate),
    contextId: MAIN_CONTEXT_ID,
    kind: childCandidate.kind,
    candidateValue: childCandidate.value,
  };
}

/**
 * Assemble the SEQUENTIAL targets bundle from the resolved menu +
 * child sub-targets. Mirrors {@link assembleClickTargets} for the
 * menu-driven path.
 * @param menuTarget - Menu trigger target.
 * @param childTarget - Child-click target.
 * @returns Dashboard targets bundle for ACTION.
 */
function assembleSequentialTargets(
  menuTarget: IResolvedTarget,
  childTarget: IResolvedTarget,
): IDashboardTargets {
  return {
    hrefTarget: NO_HREF,
    clickTarget: childTarget,
    fallbackSelector: NO_HREF,
    clickCandidateCount: 0,
    menuTarget,
  };
}

/**
 * Probe the SEQUENTIAL child candidate (a WK_TRANSACTIONS exactText that
 * exists in the DOM). Wraps the `as unknown as readonly SelectorCandidate[]`
 * narrowing so the caller can stay terse.
 * @param page - Browser page.
 * @returns Matching candidate or false when no WK_TRANSACTIONS entry exists.
 */
function probeSequentialChild(page: Page): Promise<SelectorCandidate | false> {
  const txnWk = WK_DASHBOARD.TRANSACTIONS as unknown as readonly SelectorCandidate[];
  return findFirstChildInDom(page, txnWk);
}

/**
 * Probe the SEQUENTIAL menu trigger (a real role=button + aria-haspopup
 * dropdown toggle from WK_MENU_EXPAND). Wraps the same narrowing dance
 * as {@link probeSequentialChild}.
 * @param page - Browser page.
 * @returns Matching candidate or false when no toggle matches.
 */
function probeSequentialTrigger(page: Page): Promise<SelectorCandidate | false> {
  const menuWk = WK_DASHBOARD.MENU_EXPAND as unknown as readonly SelectorCandidate[];
  return findDropdownToggleCandidate(page, menuWk);
}

/**
 * Detect the SEQUENTIAL menu-toggle-then-child pattern on the dashboard.
 * Mirrors HOME's `executeSequentialNav` shape, but uses the existing
 * Dashboard ACTION orchestrator's menu→click chain (line ~491 in this
 * file): PRE pre-resolves the visible trigger and the (still-hidden) child
 * candidate; ACTION clicks trigger → settle → clicks child via lazy
 * `text="..."` selector that Playwright evaluates AFTER the dropdown
 * opens and Angular flips `aria-hidden`.
 *
 * Fires when:
 *   - Some `exactText` candidate from WK_TRANSACTIONS exists in the DOM
 *     (the disambiguator — Max-only per offline cross-bank validation), AND
 *   - Some WK_MENU_EXPAND text candidate matches a real dropdown-toggle
 *     (role=button + aria-haspopup=true) on the page.
 *
 * Falls through (returns false) when either is missing → existing href-NAV
 * flow continues unchanged for the other 6 banks. WK-driven: trigger and
 * child texts come from WK_DASHBOARD lists, not hardcoded here.
 * @param page - Browser page.
 * @returns Populated targets when SEQUENTIAL detected, else false.
 */
async function tryDashboardSequentialNav(page: Page): Promise<IDashboardTargets | false> {
  const childCandidate = await probeSequentialChild(page);
  if (!childCandidate) return false;
  const triggerCandidate = await probeSequentialTrigger(page);
  if (!triggerCandidate) return false;
  const menuTarget = buildSequentialMenuTarget(triggerCandidate);
  const childTarget = buildSequentialChildTarget(childCandidate);
  return assembleSequentialTargets(menuTarget, childTarget);
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
 * Build the menu-only dashboard targets shape — used by
 * {@link resolveMenuFallback} so the parent stays under the LoC cap.
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

/** CSS selector for "clickable text" elements scanned by the PRE dump. */
const CLICKABLE_SEL = 'a, button, [role="tab"], [role="link"], [role="button"]';

/**
 * Collect deduped, length-filtered visible text of all clickable
 * elements on the page. Used by {@link dumpDashboardText} for WK
 * forensic logging when PRE cannot find a nav target.
 * @param page - Browser page.
 * @returns Unique visible-text snippets (length 2..59).
 */
function collectClickableTexts(page: Page): Promise<string[]> {
  return page.$$eval(CLICKABLE_SEL, (els: Element[]) => [
    ...new Set(
      els.map(el => (el.textContent || '').trim()).filter(t => t.length > 1 && t.length < 60),
    ),
  ]);
}

/**
 * Inner branch of {@link dumpDashboardText} — pulled out so the
 * caller's try/catch stays terse and the body fits under the LoC cap.
 * @param page - Already-narrowed browser page.
 * @param logger - Pipeline logger.
 * @returns Always true once the log line is emitted.
 */
async function emitClickableTextLog(page: Page, logger: IPipelineContext['logger']): Promise<true> {
  const texts = await collectClickableTexts(page);
  logger.debug({ message: `VISIBLE CLICKABLE TEXT: [${texts.join(' | ')}]` });
  return true;
}

/**
 * Dump all visible clickable text on the page for WK forensic discovery
 * when DASHBOARD.PRE cannot find a nav target. Pure observation — used
 * to enrich the failure log with what the page is actually showing.
 *
 * @param input - Pipeline context with browser.
 * @returns True when the dump emitted at least one masked log line, false
 * when no browser was attached or the underlying $$eval failed silently.
 */
async function dumpDashboardText(input: IPipelineContext): Promise<boolean> {
  if (!input.browser.has) return false;
  try {
    return await emitClickableTextLog(input.browser.value.page, input.logger);
  } catch {
    return false;
  }
}

/** Bundled PRE discovery results. */
interface IPreDiscoveryResult {
  readonly matchInfo: string;
  readonly targets: IDashboardTargets;
  readonly hasAny: boolean;
  readonly apiCtx: IApiFetchContext | false;
  readonly hasExistingTraffic: boolean;
}

/** Side-effect bundle from PRE's mediator priming. */
interface IDiscoveryPriming {
  readonly network: IElementMediator['network'];
  readonly matchInfo: string;
  readonly hasExistingTraffic: boolean;
  readonly hasAuth: boolean;
}

/**
 * Run the "prime + probe" prefix common to DASHBOARD PRE — wait for
 * network idle, cache auth, run success indicators, count traffic.
 * Extracted so {@link discoverDashboard} stays under the LoC cap.
 * @param mediator - Element mediator (already unwrapped).
 * @returns Network handle + matchInfo + traffic/auth presence bits.
 */
async function primeDiscoveryNetwork(mediator: IElementMediator): Promise<IDiscoveryPriming> {
  const network = mediator.network;
  await mediator.waitForNetworkIdle(DASHBOARD_SETTLE_MS).catch((): false => false);
  await network.cacheAuthToken();
  const matchInfo = await probeSuccessIndicators(mediator);
  const hasExistingTraffic = countTxnTraffic(network, 0) > 0;
  const authToken = await network.discoverAuthToken();
  return { network, matchInfo, hasExistingTraffic, hasAuth: Boolean(authToken) };
}

/**
 * Compute the boolean `hasAny` for the resolved dashboard targets.
 * Hides the disjunction so the PRE log call site stays expression-shaped.
 * @param targets - Resolved targets.
 * @returns True when ANY of href / click / menu was resolved.
 */
function hasAnyTarget(targets: IDashboardTargets): boolean {
  return Boolean(targets.hrefTarget) || Boolean(targets.clickTarget) || Boolean(targets.menuTarget);
}

/**
 * Emit the DASHBOARD PRE summary log line with targets + auth +
 * existing-traffic flags.
 * @param input - Pipeline context with logger.
 * @param targets - Resolved targets.
 * @param priming - Priming bundle (used for auth/traffic bits).
 * @returns Always true so the caller stays expression-shaped.
 */
function logPreDiscovery(
  input: IPipelineContext,
  targets: IDashboardTargets,
  priming: IDiscoveryPriming,
): true {
  const targetDesc = describeTargets(targets);
  const hasAuth = String(priming.hasAuth);
  const traffic = String(priming.hasExistingTraffic);
  input.logger.debug({ message: `PRE: ${targetDesc}, auth=${hasAuth}, traffic=${traffic}` });
  return true;
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
  const priming = await primeDiscoveryNetwork(mediator);
  const targets = await resolveDashboardTargets(mediator, page);
  const apiCtx = await buildApiIfAvailable(input, priming.network);
  logPreDiscovery(input, targets, priming);
  const hasAny = hasAnyTarget(targets);
  const { matchInfo, hasExistingTraffic } = priming;
  return { matchInfo, targets, hasAny, apiCtx, hasExistingTraffic };
}

/**
 * Bundle every PRE-resolved target field that ACTION consumes downstream.
 * Pulled out so {@link buildPreDiagnostics} stays under the LoC cap.
 * @param disc - Discovery bundle from {@link discoverDashboard}.
 * @returns Diagnostics fragment with all dashboard-target fields.
 */
function buildPreTargetFields(disc: IPreDiscoveryResult): Partial<IPipelineContext['diagnostics']> {
  return {
    dashboardTargetUrl: disc.targets.hrefTarget || NO_HREF,
    dashboardTarget: disc.targets.clickTarget || undefined,
    dashboardFallbackSelector: disc.targets.fallbackSelector || undefined,
    dashboardCandidateCount: disc.targets.clickCandidateCount,
    dashboardMenuTarget: disc.targets.menuTarget || undefined,
    dashboardTrafficExists: disc.hasExistingTraffic,
  };
}

/**
 * Build the diagnostics patch carrying every PRE-resolved field that
 * ACTION consumes. Pulled out so {@link executePreLocateNav} keeps
 * to the ≤10 LoC body cap.
 * @param input - Pipeline context.
 * @param disc - Discovery bundle from {@link discoverDashboard}.
 * @returns New diagnostics object for the success branch.
 */
function buildPreDiagnostics(
  input: IPipelineContext,
  disc: IPreDiscoveryResult,
): IPipelineContext['diagnostics'] {
  const targetFields = buildPreTargetFields(disc);
  return {
    ...input.diagnostics,
    lastAction: `dashboard-pre (${disc.matchInfo})`,
    ...targetFields,
  };
}

/**
 * Compose the success-procedure context for PRE — optionally
 * attaches the discovered API context when one was built.
 * @param input - Pipeline context.
 * @param diag - Diagnostics patch (already built).
 * @param apiCtx - API context to attach, or false.
 * @returns Procedure carrying the updated context.
 */
function composePreSuccess(
  input: IPipelineContext,
  diag: IPipelineContext['diagnostics'],
  apiCtx: IApiFetchContext | false,
): Procedure<IPipelineContext> {
  if (!apiCtx) return succeed({ ...input, diagnostics: diag });
  return succeed({ ...input, diagnostics: diag, api: some(apiCtx) });
}

/**
 * Handle the "no target found" branch for PRE — dumps clickable text
 * for forensic logging then returns the fail-loud procedure.
 * @param input - Pipeline context.
 * @returns Fail-loud procedure for PRE.
 */
async function failPreNoTarget(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  await dumpDashboardText(input);
  return fail(ScraperErrorTypes.Generic, 'DASHBOARD PRE: no navigation target found');
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
  const disc = await discoverDashboard(input, input.mediator.value, input.browser.value.page);
  logWinningTarget(input, disc.targets);
  if (!disc.hasAny) return failPreNoTarget(input);
  const diag = buildPreDiagnostics(input, disc);
  return composePreSuccess(input, diag, disc.apiCtx);
}

/**
 * Build the click-target description fragment of {@link describeTargets}.
 * @param target - Resolved click target.
 * @param count - Generic-selector match count.
 * @returns Human-readable target line.
 */
function describeClickTarget(target: IResolvedTarget, count: number): string {
  const n = String(count);
  return `target=${target.contextId} > ${maskVisibleText(target.selector)} (DOM matches=${n})`;
}

/**
 * Build the menu-target description fragment of {@link describeTargets}.
 * @param menuTarget - Resolved menu target.
 * @returns Human-readable menu line.
 */
function describeMenuTarget(menuTarget: IResolvedTarget): string {
  return `menu=${menuTarget.contextId} > ${maskVisibleText(menuTarget.selector)}`;
}

/**
 * Build human-readable target description for HANDOFF log.
 * @param targets - Resolved dashboard targets.
 * @returns Description string.
 */
function describeTargets(targets: IDashboardTargets): string {
  const { clickTarget, menuTarget, hrefTarget, clickCandidateCount } = targets;
  if (clickTarget) return describeClickTarget(clickTarget, clickCandidateCount);
  if (menuTarget) return describeMenuTarget(menuTarget);
  if (hrefTarget) return `href=${maskVisibleText(hrefTarget)}`;
  return 'target=NONE';
}

/**
 * Click a resolved menu target via the sealed action mediator. Best-
 * effort — failures coerce to `false` so the caller can log + skip the
 * network settle. Extracted so {@link executeMenuClick} stays terse.
 * @param executor - Sealed action mediator.
 * @param target - Pre-resolved menu target.
 * @returns True when the click resolved, false on caught error.
 */
async function tryClickMenu(executor: IActionMediator, target: IResolvedTarget): Promise<boolean> {
  const { contextId, selector } = target;
  return executor
    .clickElement({ contextId, selector, isForce: shouldForceMenuClick })
    .then((): true => true)
    .catch((): false => false);
}

/**
 * Settle the network after a successful menu click. Caller must guard
 * on `didClick` — this helper assumes the click resolved.
 * @param executor - Sealed action mediator.
 * @returns Always true once the settle attempt has resolved.
 */
async function settleAfterMenuClick(executor: IActionMediator): Promise<true> {
  await executor.waitForNetworkIdle(DASHBOARD_MENU_SETTLE_MS).catch((): false => false);
  return true;
}

/**
 * Click a menu toggle via sealed executor (force-click).
 * Best-effort: catch failures, POST validates traffic.
 * @param executor - Sealed action mediator.
 * @param target - Pre-resolved menu target.
 * @param logger - Pipeline logger.
 * @returns True if clicked.
 */
async function executeMenuClick(
  executor: IActionMediator,
  target: IResolvedTarget,
  logger: IPipelineContext['logger'],
): Promise<boolean> {
  const masked = maskVisibleText(target.selector);
  logger.debug({ strategy: 'MENU', result: `${target.contextId} > ${masked}` });
  const didClick = await tryClickMenu(executor, target);
  if (!didClick) logger.debug({ message: 'menu click failed' });
  if (didClick) await settleAfterMenuClick(executor);
  return didClick;
}

/**
 * Attempt the physical href navigation via the sealed action mediator.
 * Best-effort — failures coerce to `false` so the caller can log + skip
 * the network settle.
 * @param executor - Sealed action mediator.
 * @param href - Target URL.
 * @returns True when the navigation resolved, false on caught error.
 */
async function tryNavHref(executor: IActionMediator, href: string): Promise<boolean> {
  return executor
    .navigateTo(href, { waitUntil: 'domcontentloaded' })
    .then((): true => true)
    .catch((): false => false);
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
  executor: IActionMediator,
  href: string,
  logger: IPipelineContext['logger'],
): Promise<boolean> {
  logger.debug({ strategy: 'NAV', result: maskVisibleText(href) });
  const didClick = await tryNavHref(executor, href);
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
/**
 * Inner "we have an executor" branch of {@link executeDashboardNavigationSealed}.
 * Marks the click moment and delegates to the candidate-navigation loop.
 * Extracted so the parent stays under the LoC cap.
 * @param input - Sealed action context (executor already present).
 * @param executor - Sealed action mediator (caller already unwrapped).
 * @returns Procedure carrying the post-nav action context.
 */
async function runSealedNavWithExecutor(
  input: IActionContext,
  executor: IActionMediator,
): Promise<Procedure<IActionContext>> {
  if (input.diagnostics.dashboardTrafficExists) {
    input.logger.debug({ message: 'traffic exists -- still click for post-nav API' });
  }
  const clickAtMs = Date.now();
  executor.markDashboardClickAt(clickAtMs);
  return runCandidateNavigation(input, executor);
}

/**
 * ACTION (sealed): Physical navigation -- best-effort click.
 * Reads `diagnostics.actionAttempt` (set by BasePhase) to pick the
 * candidate from the pre-fetched list. On retry attempts (> 0) restores
 * the dashboard URL via UNDO before clicking the next candidate.
 * Menu fallback fires once (attempt 0); href fallback fires when there's
 * no candidate left to try. POST validates the txn-traffic gate.
 *
 * Phase 7f follow-up: ALWAYS click when an executor is present. The
 * pre-existing "traffic exists -- skip click" fast-path treated login-time
 * API captures as sufficient, but those are PREVIEW shapes for
 * Amex/Isracard (`GetLatestTransactions` 5-cap) — the real historical API
 * only fires after the dashboard navigation. Skipping the click left those
 * banks stuck on the preview cap; forcing the click is bank-agnostic
 * (Discount/Hapoalim/etc. already clicked) and surfaces the post-nav
 * captures the picker wants.
 *
 * @param input - Sealed action context with executor + diagnostics targets.
 * @returns Always succeed -- POST is the validator.
 */
async function executeDashboardNavigationSealed(
  input: IActionContext,
): Promise<Procedure<IActionContext>> {
  if (!input.executor.has) {
    input.logger.debug({ message: 'no executor -- traffic from login' });
    return succeed(input);
  }
  return runSealedNavWithExecutor(input, input.executor.value);
}

/**
 * URL-pattern signal — universal post-click "did we land on the txn page?".
 * Bank-agnostic: works for browser-driven banks (Beinleumi pm.q077 → online.fibi
 * .co.il/.../transactions) AND proxy-fetch banks (Isracard right-click →
 * digital.isracard.co.il/.../Transactions). Driven by `WK_DASHBOARD.TXN_PAGE_PATTERNS`.
 * @param url - Current URL after click.
 * @returns True iff URL matches any known transactions-page pattern.
 */
function isTxnPageUrl(url: string): boolean {
  return WK_DASHBOARD.TXN_PAGE_PATTERNS.some((pat): boolean => pat.test(url));
}

/** Force-click flag for candidate clicks (matches existing menu/legacy
 *  pattern; declared as a const so the DI lint rule treats it the same
 *  as `shouldForceMenuClick`). */
const shouldForceCandidateClick = true;

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
  executor: IActionMediator,
  isOnTxnPage: boolean,
): Promise<boolean> {
  if (isOnTxnPage) {
    return executor.waitForTxnEndpoint(DASHBOARD_POST_MATCH_TXN_WAIT_MS).catch((): false => false);
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
/** Read the candidate-navigation diagnostics fields into a typed bundle. */
interface ICandidateNavDiag {
  readonly target?: IResolvedTarget;
  readonly fallbackSelector: string;
  readonly count: number;
  readonly menuTarget?: IResolvedTarget;
  readonly hrefTarget?: string;
}

/**
 * Read the four diagnostics fields the candidate-navigation loop needs
 * into a typed bundle, applying the standard defaults.
 * @param diag - Action diagnostics from PRE.
 * @returns Bundled candidate-navigation inputs.
 */
function readCandidateNavDiag(diag: IActionContext['diagnostics']): ICandidateNavDiag {
  return {
    target: diag.dashboardTarget,
    fallbackSelector: diag.dashboardFallbackSelector ?? NO_HREF,
    count: diag.dashboardCandidateCount ?? 0,
    menuTarget: diag.dashboardMenuTarget,
    hrefTarget: diag.dashboardTargetUrl,
  };
}

/**
 * Candidate navigation — owned ENTIRELY by ACTION. Executes any pre-
 * resolved menu fallback, then dispatches to the identity-then-fallback
 * walker for clicks, or the href-nav helper. POST is the loose any-
 * endpoint gate.
 * @param input - Sealed action context.
 * @param executor - Sealed action mediator (caller already unwrapped).
 * @returns Procedure carrying the post-nav action context.
 */
async function runCandidateNavigation(
  input: IActionContext,
  executor: IActionMediator,
): Promise<Procedure<IActionContext>> {
  const diag = readCandidateNavDiag(input.diagnostics);
  if (diag.menuTarget) await executeMenuClick(executor, diag.menuTarget, input.logger);
  if (diag.target) {
    const { target, fallbackSelector, count } = diag;
    return runIdentityThenFallback({ executor, target, fallbackSelector, count, input });
  }
  if (diag.hrefTarget) await executeHrefNav(executor, diag.hrefTarget, input.logger);
  return succeed(input);
}

/** Bundled args for the two-stage walker — fits 3-param ceiling. */
interface IIterateArgs {
  readonly executor: IActionMediator;
  readonly target: IResolvedTarget;
  readonly fallbackSelector: string;
  readonly count: number;
  readonly input: IActionContext;
}

/** Bundled args for a single click attempt evaluation. */
interface IClickAttemptArgs {
  readonly executor: IActionMediator;
  readonly contextId: IResolvedTarget['contextId'];
  readonly selector: string;
  readonly nth?: number;
  readonly attemptLabel: string;
  readonly input: IActionContext;
}

/** Outcome of a single click attempt — success bit + URL before for goback. */
interface IClickOutcome {
  readonly isSuccess: boolean;
  readonly urlBefore: string;
  readonly urlAfter: string;
}

/**
 * Emit the "starting CLICK" log line for {@link evaluateClickAttempt}.
 * @param input - Action context for logger access.
 * @param args - Bundled click attempt arguments.
 * @returns Always true so the caller stays expression-shaped.
 */
function logClickStart(input: IActionContext, args: IClickAttemptArgs): true {
  input.logger.debug({
    strategy: 'CLICK',
    attempt: args.attemptLabel,
    result: `${args.contextId} > ${maskVisibleText(args.selector)}`,
  });
  return true;
}

/**
 * Best-effort click + settle for {@link evaluateClickAttempt}. Failures
 * coerce to false; the txn signal is the validator either way.
 * @param args - Bundled click attempt arguments.
 * @returns Always true once the click + settle attempt has resolved.
 */
async function dispatchClickAndSettle(args: IClickAttemptArgs): Promise<true> {
  const { executor, contextId, selector, nth } = args;
  await executor
    .clickElement({ contextId, selector, isForce: shouldForceCandidateClick, nth })
    .then((): true => true)
    .catch((): false => false);
  await executor.waitForNetworkIdle().catch((): false => false);
  return true;
}

/** Bundled signal-read result for {@link evaluateClickAttempt}. */
interface IClickSignal {
  readonly isHasTxn: boolean;
  readonly isOnTxnPage: boolean;
  readonly isSuccess: boolean;
  readonly urlAfter: string;
}

/**
 * Evaluate the post-click txn signal (BFF endpoint capture OR URL on a
 * known TXN_PAGE_PATTERN). Pulled out so {@link evaluateClickAttempt}
 * stays under the LoC cap.
 * @param executor - Sealed action mediator.
 * @returns hasTxn + isOnTxnPage + success bit + post-click URL.
 */
async function readClickSignal(executor: IActionMediator): Promise<IClickSignal> {
  const urlAfter = executor.getCurrentUrl();
  const isOnTxnPage = isTxnPageUrl(urlAfter);
  const isHasTxn = await confirmTxnEndpoint(executor, isOnTxnPage);
  return { isHasTxn, isOnTxnPage, urlAfter, isSuccess: isHasTxn || isOnTxnPage };
}

/**
 * Emit the OK log line when {@link evaluateClickAttempt} sees a txn signal.
 * No-op on failure (the caller's caller logs the miss).
 * @param input - Action context for logger access.
 * @param attemptLabel - Identity/F-N attempt label.
 * @param signal - Post-click signal bundle with hasTxn + urlAfter.
 * @returns Always true so the caller stays expression-shaped.
 */
function logClickSuccess(input: IActionContext, attemptLabel: string, signal: IClickSignal): true {
  input.logger.debug({
    strategy: 'CLICK',
    attempt: attemptLabel,
    result: `OK — hasTxn=${String(signal.isHasTxn)} url=${signal.urlAfter}`,
  });
  return true;
}

/**
 * Execute a click + evaluate post-click txn signal. Single source of truth
 * for the success criteria (URL match OR BFF txn endpoint observable).
 * @param args - Bundled click attempt arguments.
 * @returns Outcome with success bit and url state.
 */
async function evaluateClickAttempt(args: IClickAttemptArgs): Promise<IClickOutcome> {
  const urlBefore = args.executor.getCurrentUrl();
  logClickStart(args.input, args);
  await dispatchClickAndSettle(args);
  const signal = await readClickSignal(args.executor);
  if (signal.isSuccess) logClickSuccess(args.input, args.attemptLabel, signal);
  return { isSuccess: signal.isSuccess, urlBefore, urlAfter: signal.urlAfter };
}

/**
 * Restore the page to the pre-click URL when a click navigated somewhere
 * other than the txn page. Used between fallback iteration attempts.
 * @param executor - Sealed action mediator.
 * @param outcome - Click outcome with url before/after.
 * @param logger - Pipeline logger.
 * @returns True when a goback navigation was attempted, false when the
 * URL was already at the pre-click value (no-op skip).
 */
async function restoreUrlIfChanged(
  executor: IActionMediator,
  outcome: IClickOutcome,
  logger: IActionContext['logger'],
): Promise<boolean> {
  if (outcome.urlAfter === outcome.urlBefore) return false;
  logger.debug({ message: `goback: ${maskVisibleText(outcome.urlBefore)}` });
  await executor.navigateTo(outcome.urlBefore, { waitUntil: 'load' }).catch((): false => false);
  await executor.waitForNetworkIdle().catch((): false => false);
  return true;
}

/**
 * Run the STAGE-1 identity click for {@link runIdentityThenFallback}.
 * Pulled out so the parent stays under the LoC cap.
 * @param args - Bundled iteration arguments.
 * @returns Outcome of the identity click attempt.
 */
function runIdentityAttempt(args: IIterateArgs): Promise<IClickOutcome> {
  return evaluateClickAttempt({
    executor: args.executor,
    contextId: args.target.contextId,
    selector: args.target.selector,
    attemptLabel: 'identity',
    input: args.input,
  });
}

/**
 * Two-stage walker entry: identity click first, then iterate fallback nth(0..count-1).
 * @param args - Bundled iteration arguments.
 * @returns Procedure once a click landed on a txn page or all options exhausted.
 */
async function runIdentityThenFallback(args: IIterateArgs): Promise<Procedure<IActionContext>> {
  const identityOutcome = await runIdentityAttempt(args);
  if (identityOutcome.isSuccess) return succeed(args.input);
  await restoreUrlIfChanged(args.executor, identityOutcome, args.input.logger);
  if (!args.fallbackSelector || args.count <= 1) return succeed(args.input);
  return walkFallbackNth(args, 0);
}

/**
 * Run one F-N attempt for {@link walkFallbackNth}. Extracted so the
 * recursive parent stays under the LoC cap.
 * @param args - Bundled iteration arguments.
 * @param i - Current 0-based nth index.
 * @returns Outcome of the click attempt at .nth(i).
 */
function runFallbackAttempt(args: IIterateArgs, i: number): Promise<IClickOutcome> {
  return evaluateClickAttempt({
    executor: args.executor,
    contextId: args.target.contextId,
    selector: args.fallbackSelector,
    nth: i,
    attemptLabel: `nth=${String(i)}`,
    input: args.input,
  });
}

/**
 * Iterate `.nth(0..count-1)` of the generic fallback selector when identity
 * click failed. Tail-recursive (no for-loop) to satisfy `no-await-in-loop`.
 * @param args - Bundled iteration arguments.
 * @param i - Current 0-based nth index.
 * @returns Procedure for the action context.
 */
async function walkFallbackNth(args: IIterateArgs, i: number): Promise<Procedure<IActionContext>> {
  if (i >= args.count) return succeed(args.input);
  const outcome = await runFallbackAttempt(args, i);
  if (outcome.isSuccess) return succeed(args.input);
  await restoreUrlIfChanged(args.executor, outcome, args.input.logger);
  return walkFallbackNth(args, i + 1);
}

/** Bundle of POST-time traffic counters used by the delta log. */
interface IPostDelta {
  readonly preNavCount: number;
  readonly postNavCount: number;
  readonly clickAt: number;
}

/**
 * Read the pre/post-nav capture counts + the masked click timestamp.
 * Extracted so {@link executeValidateTraffic} stays under the LoC cap.
 * @param network - Network discovery handle.
 * @returns Bundle of counts + clickAt for the delta log.
 */
function readPostDelta(network: IElementMediator['network']): IPostDelta {
  const preNavCount = network.getPreNavCaptures().length;
  const postNavCount = network.getPostNavCaptures().length;
  const rawClickAt = network.getDashboardClickAt();
  return { preNavCount, postNavCount, clickAt: clickAtForLog(rawClickAt) };
}

/**
 * Emit the `dashboard.post.delta` log event for {@link executeValidateTraffic}.
 * @param input - Pipeline context with logger.
 * @param delta - Pre-built delta bundle.
 * @returns Always true so the caller stays expression-shaped.
 */
function logPostDelta(input: IPipelineContext, delta: IPostDelta): true {
  input.logger.debug({ event: 'dashboard.post.delta', ...delta });
  return true;
}

/**
 * Read the post-nav delta off the mediator's network and emit the
 * structured log event. Bundled so {@link executeValidateTraffic} stays
 * under the LoC cap with no nested calls.
 * @param input - Pipeline context with logger.
 * @param mediator - Element mediator (already unwrapped).
 * @returns Always true so the caller stays expression-shaped.
 */
function emitPostDeltaFromMediator(input: IPipelineContext, mediator: IElementMediator): true {
  const delta = readPostDelta(mediator.network);
  return logPostDelta(input, delta);
}

/**
 * Build the success-branch dashboard state for {@link executeValidateTraffic}.
 * @param pageUrl - Current URL captured at POST time.
 * @returns Ready dashboard state with traffic primed.
 */
function buildDashState(pageUrl: string): IDashboardState {
  return { isReady: true, pageUrl, trafficPrimed: true };
}

/**
 * Run the password-change probe + the primed-traffic gate. Extracted so
 * {@link executeValidateTraffic} keeps to the LoC cap; both calls are
 * sequenced because the pwd check may fail-loud before the gate runs.
 * @param mediator - Element mediator (already unwrapped).
 * @param input - Pipeline context (for logger access).
 * @returns Fail procedure when pwd flagged; otherwise the primed gate bit.
 */
async function runPwdAndPrime(
  mediator: IElementMediator,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext> | boolean> {
  const pwdCheck = await checkChangePassword(mediator);
  if (pwdCheck) return pwdCheck;
  return validateTrafficGate(mediator.network, input.logger);
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
/**
 * Read the current URL + emit the POST primed log line. Pulled out so
 * {@link executeValidateTraffic} stays under the LoC cap.
 * @param input - Pipeline context (for logger access).
 * @param mediator - Element mediator (already unwrapped).
 * @param primed - Result of the traffic-gate probe.
 * @returns Current page URL captured at POST time.
 */
function logPrimedAndReadUrl(
  input: IPipelineContext,
  mediator: IElementMediator,
  primed: boolean,
): string {
  const pageUrl = mediator.getCurrentUrl();
  input.logger.debug({ primed, url: maskVisibleText(pageUrl) });
  return pageUrl;
}

/**
 * POST: Change-password check + simple traffic gate (HEAD-equivalent).
 *
 * The "did the click do the right thing?" decision now lives INSIDE
 * dashboard ACTION's candidate-iteration loop. POST just confirms ANY
 * traffic was hasTxn — same trivial gate HEAD uses.
 *
 * @param input - Pipeline context.
 * @returns Updated context with dashboard state.
 */
async function executeValidateTraffic(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return fail(ScraperErrorTypes.Generic, 'DASHBOARD POST: no mediator');
  const mediator = input.mediator.value;
  const primedOrFail = await runPwdAndPrime(mediator, input);
  if (typeof primedOrFail !== 'boolean') return primedOrFail;
  return finalizePrimedTraffic(input, mediator, primedOrFail);
}

/**
 * Tail of {@link executeValidateTraffic} that runs after PWD priming
 * settles. Logs the primed URL, emits the post-delta telemetry, then
 * either fails loud (no API traffic) or commits the assembled
 * dashboard state. Pulled out so the caller stays under the LoC cap.
 *
 * @param input - Pipeline context.
 * @param mediator - Unwrapped mediator (caller-side narrowed).
 * @param primed - Whether PWD priming captured txn-shape traffic.
 * @returns Procedure with the committed dashboard state, or a failure.
 */
function finalizePrimedTraffic(
  input: IPipelineContext,
  mediator: IElementMediator,
  primed: boolean,
): Procedure<IPipelineContext> {
  const pageUrl = logPrimedAndReadUrl(input, mediator, primed);
  emitPostDeltaFromMediator(input, mediator);
  if (!primed) return fail(ScraperErrorTypes.Generic, 'DASHBOARD POST: no API traffic hasTxn');
  const dashState = buildDashState(pageUrl);
  const dashboard = some(dashState);
  return succeed({ ...input, dashboard });
}

/**
 * Build the API-context override bundle from the pipeline config. Pulled
 * out so {@link maybeAttachApi} stays under the LoC cap.
 * @param input - Pipeline context with config.
 * @returns Override bundle for {@link buildApiContext}.
 */
function buildOverrideFromConfig(input: IPipelineContext): {
  readonly baseUrl: string;
  readonly transactionsPath?: string;
} {
  return { baseUrl: input.config.urls.base, transactionsPath: input.config.transactionsPath };
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
  const override = buildOverrideFromConfig(input);
  const apiCtx = await buildApiContext(network, input.fetchStrategy.value, override);
  return { ...input, api: some(apiCtx) };
}

/**
 * Count hasTxn endpoints from mediator if available.
 * @param ctx - Pipeline context.
 * @returns Endpoint count string.
 */
function countEndpoints(ctx: IPipelineContext): string {
  if (!ctx.mediator.has) return '0';
  return String(ctx.mediator.value.network.getAllEndpoints().length);
}

/**
 * FINAL: Build API context + collect auth + endpoints -> signal to SCRAPE.
 * @param input - Pipeline context.
 * @returns Updated context with api + auth in diagnostics.
 */
/** WK transactions URL patterns used by FINAL's gatekeeper. */
const FINAL_TXN_PATTERNS = PIPELINE_WELL_KNOWN_API.transactions;

/**
 * MOCK_MODE active flag — mirrors the ACCOUNT-RESOLVE.POST and
 * OtpFillPhaseActions valves. Live E2E is the only environment where
 * the DASHBOARD.FINAL fail-loud checks are enforceable; the offline
 * snapshot suite has no captured network traffic.
 */
const isMockModeDashboardFinalActive =
  process.env.MOCK_MODE === '1' || process.env.MOCK_MODE === 'true';

/** Bundled bucket counts emitted on the `dashboard.signal.ready` event. */
interface INavBucketCounts {
  readonly preNavCount: number;
  readonly postNavCount: number;
}

/**
 * Count the pre-nav / post-nav capture buckets for the FINAL signal.
 * Returns zeros when the mediator hasn't been attached. Pulled out
 * to keep `executeCollectAndSignal` free of inline ternaries.
 * @param ctx - Pipeline context.
 * @returns Bucket counts.
 */
function countNavBuckets(ctx: IPipelineContext): INavBucketCounts {
  if (!ctx.mediator.has) return { preNavCount: 0, postNavCount: 0 };
  const network = ctx.mediator.value.network;
  return {
    preNavCount: network.getPreNavCaptures().length,
    postNavCount: network.getPostNavCaptures().length,
  };
}

/**
 * Verify the post-nav bucket (with soft-fallback) carries at least
 * one WK-transactions URL match. This is the architectural contract
 * the user spec requires: DASHBOARD.FINAL hands SCRAPE.PRE a complete
 * `{ preNavCaptures, postNavCaptures }` payload where postNav is
 * known-good. SCRAPE.PRE then performs pure discovery without any
 * re-validation.
 * @param ctx - Pipeline context.
 * @returns True iff a WK-transactions match exists in postNav.
 */
function hasPostNavTxnMatch(ctx: IPipelineContext): boolean {
  if (!ctx.mediator.has) return false;
  const postNav = ctx.mediator.value.network.getPostNavCaptures();
  return postNav.some((ep): boolean =>
    FINAL_TXN_PATTERNS.some((p: RegExp): boolean => p.test(ep.url)),
  );
}

/**
 * FINAL: gate the phase, build API context, and emit the
 * `dashboard.signal.ready` event for SCRAPE.PRE.
 * @param input - Pipeline context.
 * @returns Updated context with API + canonical signal, or fail.
 */
/**
 * Wait until the post-nav pool exposes at least one WK-txn URL match.
 * Returns immediately when a match is already present; otherwise polls
 * the live network's traffic stream up to the budget. Returns `true` on
 * any successful match within budget; `false` on timeout (FINAL escalates
 * to F-DASH-1).
 *
 * <p>Intentionally NOT using the `raceWithNetworkIdle` smart-wait
 * (added for ACCOUNT-RESOLVE.PRE in the same PR). DASHBOARD.FINAL runs
 * AFTER ~80 s of pipeline traversal — by this point the page is
 * typically already in `networkidle` state, so a race would resolve
 * the networkidle side immediately and skip the actual txn-traffic
 * wait. ACCOUNT-RESOLVE.PRE runs right after AUTH-DISCOVERY when the
 * page is still mid-load, so the race works there but is the WRONG
 * signal here. VisaCal pre-commit live-E2E run on 2026-05-17 verified
 * this: with the race here, DASHBOARD.FINAL failed in 2 ms because
 * networkidle had already been reached.
 *
 * @param input - Pipeline context.
 * @returns True when a match landed (or was already present); false on timeout.
 */
async function waitForPostNavTxnMatch(input: IPipelineContext): Promise<boolean> {
  if (!input.mediator.has) return true;
  if (hasPostNavTxnMatch(input)) return true;
  const hit = await input.mediator.value.network
    .waitForTransactionsTraffic(DASHBOARD_FINAL_TXN_WAIT_MS)
    .catch((): false => false);
  return hit !== false;
}

/**
 * Wait gate at the head of FINAL — returns fail-loud when the post-nav pool
 * has no WK-txn match within the budget. Pulled out so
 * {@link executeCollectAndSignal} stays under the LoC cap.
 * @param input - Pipeline context.
 * @returns Fail procedure on miss, or false to continue.
 */
async function gateFinalTxnMatch(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext> | false> {
  const isMatched = await waitForPostNavTxnMatch(input);
  if (input.mediator.has && !isMatched) {
    return fail(
      ScraperErrorTypes.Generic,
      'DASHBOARD FINAL: DASHBOARD_TXN_ENDPOINT_MISSING — post-nav pool empty of WK-txn matches after wait budget',
    );
  }
  return false;
}

/** Bundle of post-commit FINAL state used to compose the success branch. */
interface IFinalSignalState {
  readonly diag: IPipelineContext['diagnostics'];
  readonly hasAuth: boolean;
  readonly epCount: string;
  readonly preNavCount: number;
  readonly postNavCount: number;
}

/**
 * Build the FINAL post-commit state bundle — diagnostics patch + counts
 * for the signal-ready event. Pulled out so
 * {@link executeCollectAndSignal} stays under the LoC cap.
 * @param ctx - Pipeline context after the TXN endpoint commit.
 * @returns Bundle for the signal-ready emit + success procedure.
 */
/**
 * Build the diagnostics patch for FINAL: `discoveredAuth` + `finalUrl`.
 * Extracted so {@link buildFinalSignalState} stays under the LoC cap.
 * @param ctx - Pipeline context after TXN commit.
 * @returns Diagnostics patch + the discoveredAuth string for reuse.
 */
async function buildFinalDiagPatch(ctx: IPipelineContext): Promise<{
  readonly diag: IPipelineContext['diagnostics'];
  readonly discoveredAuth: string | false;
}> {
  const dashUrl = ctx.dashboard.has && ctx.dashboard.value.pageUrl;
  const discoveredAuth = await extractAuthFromContext(ctx);
  const diag = { ...ctx.diagnostics, finalUrl: some(dashUrl || ''), discoveredAuth };
  return { diag, discoveredAuth };
}

/**
 * Assemble the {@link IFinalSignalState} bundle from already-computed
 * inputs. Pulled out so {@link buildFinalSignalState} stays under the
 * LoC cap (the 5-field object literal otherwise dominates the body).
 * @param diag - Pre-built diagnostics patch.
 * @param hasAuth - Whether auth was discovered.
 * @param ctx - Pipeline context (for endpoint count + bucket counts).
 * @returns FINAL signal state bundle.
 */
function assembleFinalSignalState(
  diag: IPipelineContext['diagnostics'],
  hasAuth: boolean,
  ctx: IPipelineContext,
): IFinalSignalState {
  const counts = countNavBuckets(ctx);
  return {
    diag,
    hasAuth,
    epCount: countEndpoints(ctx),
    preNavCount: counts.preNavCount,
    postNavCount: counts.postNavCount,
  };
}

/**
 * Build the FINAL post-commit state bundle — diagnostics patch + counts
 * for the signal-ready event. Pulled out so {@link executeCollectAndSignal}
 * stays under the LoC cap.
 * @param ctx - Pipeline context after the TXN endpoint commit.
 * @returns Bundle for the signal-ready emit + success procedure.
 */
async function buildFinalSignalState(ctx: IPipelineContext): Promise<IFinalSignalState> {
  const { diag, discoveredAuth } = await buildFinalDiagPatch(ctx);
  const hasAuth = Boolean(discoveredAuth);
  return assembleFinalSignalState(diag, hasAuth, ctx);
}

/**
 * Emit the canonical `dashboard.signal.ready` event for SCRAPE.PRE.
 * preNavCount / postNavCount form the materialised contract.
 * @param input - Pipeline context with logger.
 * @param state - Pre-built FINAL signal state.
 * @returns Always true so the caller stays expression-shaped.
 */
function logSignalReady(input: IPipelineContext, state: IFinalSignalState): true {
  input.logger.debug({
    event: 'dashboard.signal.ready',
    authFound: state.hasAuth,
    endpoints: state.epCount,
    preNavCount: state.preNavCount,
    postNavCount: state.postNavCount,
  });
  return true;
}

/**
 * Emit the signal-ready log line and compose the FINAL success procedure.
 * Pulled out so {@link executeCollectAndSignal} stays under the LoC cap.
 * @param ctx - Pipeline context after TXN commit (carries logger).
 * @param state - Pre-built FINAL signal state.
 * @returns Success procedure carrying the patched diagnostics.
 */
function emitSignalReadyAndSucceed(
  ctx: IPipelineContext,
  state: IFinalSignalState,
): Procedure<IPipelineContext> {
  logSignalReady(ctx, state);
  return succeed({ ...ctx, diagnostics: state.diag });
}

/**
 * FINAL: gate the phase, build API context, and emit the
 * `dashboard.signal.ready` event for SCRAPE.PRE.
 * @param input - Pipeline context.
 * @returns Updated context with API + canonical signal, or fail.
 */
async function executeCollectAndSignal(
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  if (!input.dashboard.has) return fail(ScraperErrorTypes.Generic, 'DASHBOARD FINAL: not ready');
  const gate = await gateFinalTxnMatch(input);
  if (gate !== false) return gate;
  const withApi = await maybeAttachApi(input);
  const txnCommitted = await commitTxnEndpoint(withApi);
  if (!txnCommitted.ok) return txnCommitted.failure;
  const state = await buildFinalSignalState(txnCommitted.ctx);
  return emitSignalReadyAndSucceed(txnCommitted.ctx, state);
}

/** Outcome of {@link commitTxnEndpoint} — discriminated success/fail. */
interface ITxnCommitOutcome {
  readonly ok: boolean;
  readonly ctx: IPipelineContext;
  readonly failure: Procedure<IPipelineContext>;
}

/**
 * Phase 7e — commit the resolved TXN endpoint to `ctx.txnEndpoint`,
 * or fail loud with `DASHBOARD_TXN_FIELDMAP_INCOMPLETE` when the
 * resolver cannot pick a date AND amount field. Mirrors the
 * ACCOUNT-RESOLVE.POST contract: every successful run either commits
 * the endpoint OR halts the pipeline before SCRAPE starts. The
 * MOCK_MODE valve preserves the offline snapshot suite — no captured
 * network traffic, no fail-loud applicable.
 *
 * @param ctx - Pipeline context after `maybeAttachApi`.
 * @returns Outcome carrying the updated context (success) or the
 *   fail-loud procedure to propagate.
 */
/**
 * Read the count of accounts ACCOUNT-RESOLVE.POST committed onto
 * `ctx.accountDiscovery.ids`. Returns 0 when the option is absent
 * (mock-mode bypass / replay tests). Used by
 * {@link commitTxnEndpoint} to feed the harvest's context-aware
 * multi-scope decision.
 *
 * @param ctx - Pipeline context.
 * @returns Number of resolved account ids, or 0 when absent.
 */
function readAccountIdCount(ctx: IPipelineContext): number {
  if (!ctx.accountDiscovery.has) return 0;
  return ctx.accountDiscovery.value.ids.length;
}

/** Sentinel empty-failure procedure used by success branches of commit helpers. */
const EMPTY_COMMIT_FAILURE = fail(ScraperErrorTypes.Generic, '');

/** Reason text for the dormant-empty commit log line — extracted for the 100-col cap. */
const DORMANT_COMMIT_REASON =
  'resolveTxnEndpoint returned false; captured pool carries empty-window evidence — ' +
  'committing empty endpoint per spec.txt:162';

/**
 * Build the dormant-empty context patch — applies the empty endpoint +
 * harvest. Pulled out so {@link commitDormantEmptyEndpoint} stays
 * under the LoC cap.
 * @param ctx - Pipeline context to patch.
 * @returns Pipeline context with dormant-empty commits applied.
 */
function buildDormantEmptyCtx(ctx: IPipelineContext): IPipelineContext {
  const txnEndpoint = some(EMPTY_TXN_ENDPOINT);
  const dashboardTxnHarvest = some(EMPTY_TXN_HARVEST);
  return { ...ctx, txnEndpoint, dashboardTxnHarvest };
}

/**
 * Phase H'' (2026-05-15): commit an empty endpoint shape when the
 * captured pool carries dormant-account evidence. SCRAPE produces
 * `txns:[]` naturally; the existing `isAllAccountsEmpty` predicate
 * in SCRAPE.POST stays as the single loud signal per spec.txt:162.
 *
 * @param ctx - Pipeline context.
 * @returns Outcome carrying the empty-endpoint commit.
 */
function commitDormantEmptyEndpoint(ctx: IPipelineContext): ITxnCommitOutcome {
  ctx.logger.debug({ event: 'dashboard.txnEndpoint.dormantEmpty', reason: DORMANT_COMMIT_REASON });
  const newCtx = buildDormantEmptyCtx(ctx);
  return { ok: true, ctx: newCtx, failure: EMPTY_COMMIT_FAILURE };
}

/** Reason text for the fail-loud debug log line — extracted for the 100-col cap. */
const FIELDMAP_FAIL_LOUD_REASON =
  'resolveTxnEndpoint returned false; TXN body missing date or amount field aliases';

/**
 * Build the FIELDMAP_INCOMPLETE fail-loud procedure used by {@link commitTxnEndpointFailLoud}.
 * @returns Fail procedure carrying the canonical error message.
 */
function buildFieldMapFailLoud(): Procedure<IPipelineContext> {
  return fail(
    ScraperErrorTypes.Generic,
    `DASHBOARD FINAL: DASHBOARD_TXN_FIELDMAP_INCOMPLETE — ${FIELDMAP_FAIL_LOUD_REASON}`,
  );
}

/**
 * Fail loud — picker returned no WK-txn URL AND no dormant evidence
 * exists in the captured pool. The pipeline halts before SCRAPE per
 * the binary contract (commit-or-halt).
 *
 * @param ctx - Pipeline context.
 * @returns Outcome carrying the fail-loud procedure.
 */
function commitTxnEndpointFailLoud(ctx: IPipelineContext): ITxnCommitOutcome {
  ctx.logger.debug({
    event: 'dashboard.txnEndpoint.failLoud',
    code: 'DASHBOARD_TXN_FIELDMAP_INCOMPLETE',
    reason: FIELDMAP_FAIL_LOUD_REASON,
  });
  return { ok: false, ctx, failure: buildFieldMapFailLoud() };
}

/**
 * Phase H'' (2026-05-15): branch on the captured pool when the
 * picker returned false. Dormant evidence → commit-empty (Hapoalim
 * home-page/composite/myAccount pattern); no evidence → fail loud
 * per the legacy F-DASH-2 contract. Caller guarantees `mediator.has`.
 *
 * @param ctx - Pipeline context with a live mediator.
 * @param network - Live network discovery handle (caller-narrowed).
 * @returns Outcome — commit-empty (ok) or fail-loud (not ok).
 */
function handleNoTxnEndpoint(ctx: IPipelineContext, network: INetworkDiscovery): ITxnCommitOutcome {
  const pool = network.getAllEndpoints();
  if (detectDormantEvidence(pool)) return commitDormantEmptyEndpoint(ctx);
  return commitTxnEndpointFailLoud(ctx);
}

/**
 * Phase 7e — commit the resolved TXN endpoint to `ctx.txnEndpoint`,
 * or fail loud with `DASHBOARD_TXN_FIELDMAP_INCOMPLETE` when the
 * resolver cannot pick a date AND amount field. Mirrors the
 * ACCOUNT-RESOLVE.POST contract: every successful run either commits
 * the endpoint OR halts the pipeline before SCRAPE starts. The
 * MOCK_MODE valve preserves the offline snapshot suite — no captured
 * network traffic, no fail-loud applicable.
 *
 * @param ctx - Pipeline context after `maybeAttachApi`.
 * @returns Outcome carrying the updated context (success) or the
 *   fail-loud procedure to propagate.
 */
/**
 * Sentinel "no-op" success outcome used when the commit is bypassed
 * (mediator-less or mock-mode).
 * @param ctx - Pipeline context to pass through unchanged.
 * @returns Success outcome that leaves the context untouched.
 */
function buildBypassOutcome(ctx: IPipelineContext): ITxnCommitOutcome {
  return { ok: true, ctx, failure: EMPTY_COMMIT_FAILURE };
}

/** Static `event` tag for the committed-endpoint telemetry payload. */
const TXN_COMMITTED_EVENT = 'dashboard.txnEndpoint.committed';

/**
 * Build the endpoint-derived half of {@link buildTxnCommittedPayload}.
 * Pulled out so neither helper exceeds the LoC cap.
 * @param internal - Resolver result that was just committed.
 * @returns Endpoint fingerprint fragment.
 */
function buildTxnEndpointFingerprint(internal: ITxnEndpointInternal): Record<string, unknown> {
  return {
    method: internal.endpoint.method,
    fieldMapDate: internal.endpoint.fieldMap.date,
    fieldMapAmount: internal.endpoint.fieldMap.amount,
    pendingUrlPresent: internal.endpoint.pendingUrl !== false,
    billingUrlPresent: internal.endpoint.billingUrl !== false,
  };
}

/**
 * Build the resolver-context half of {@link buildTxnCommittedPayload}
 * — captureIndex / pickerTier / record counts.
 * @param internal - Resolver result that was just committed.
 * @returns Resolver-context fragment.
 */
function buildTxnResolverContext(internal: ITxnEndpointInternal): Record<string, unknown> {
  return {
    captureIndex: internal.captureIndex,
    normalizedRecords: internal.normalizedRecords.length,
    pickerTier: internal.pickerTier,
    capturedPreClick: internal.capturedPreClick,
  };
}

/**
 * Build the structured payload for the `dashboard.txnEndpoint.committed`
 * event by merging the endpoint fingerprint with the resolver context.
 * @param internal - Resolver result that was just committed.
 * @returns Telemetry payload literal.
 */
function buildTxnCommittedPayload(internal: ITxnEndpointInternal): Record<string, unknown> {
  return {
    event: TXN_COMMITTED_EVENT,
    ...buildTxnEndpointFingerprint(internal),
    ...buildTxnResolverContext(internal),
  };
}

/**
 * Emit the `dashboard.txnEndpoint.committed` debug event describing the
 * picked TXN endpoint's fingerprint. Pulled out so {@link commitTxnEndpoint}
 * stays under the LoC cap; the literal would otherwise dominate the body.
 * @param ctx - Pipeline context (for logger access).
 * @param internal - Resolver result that was just committed.
 * @returns Always true so the caller stays expression-shaped.
 */
function logTxnEndpointCommitted(ctx: IPipelineContext, internal: ITxnEndpointInternal): true {
  const payload = buildTxnCommittedPayload(internal);
  ctx.logger.debug(payload);
  return true;
}

/**
 * Emit the `dashboard.txnHarvest.committed` debug event describing the
 * pre-extracted records harvest committed alongside the endpoint.
 * @param ctx - Pipeline context (for logger access).
 * @param harvest - Harvest payload that was just committed.
 * @returns Always true so the caller stays expression-shaped.
 */
function logTxnHarvestCommitted(ctx: IPipelineContext, harvest: IDashboardTxnHarvest): true {
  ctx.logger.debug({
    event: 'dashboard.txnHarvest.committed',
    records: harvest.records.length,
    capturedAccountIdPresent: harvest.capturedAccountId !== false,
    multiAccountScope: harvest.multiAccountScope,
  });
  return true;
}

/**
 * Patch the pipeline context with the just-resolved TXN endpoint +
 * harvest. Pulled out so {@link commitResolvedEndpoint} stays terse.
 * @param ctx - Pipeline context.
 * @param internal - Resolver result carrying the endpoint to commit.
 * @param harvest - Harvest payload to commit.
 * @returns Pipeline context with both options populated.
 */
function applyEndpointCommit(
  ctx: IPipelineContext,
  internal: ITxnEndpointInternal,
  harvest: IDashboardTxnHarvest,
): IPipelineContext {
  return { ...ctx, txnEndpoint: some(internal.endpoint), dashboardTxnHarvest: some(harvest) };
}

/**
 * Commit a successfully-resolved TXN endpoint + its pre-extracted harvest
 * to the pipeline context, emitting both debug events for telemetry.
 * Extracted so {@link commitTxnEndpoint} stays under the LoC cap.
 * @param ctx - Pipeline context with a live mediator.
 * @param internal - Resolver result carrying endpoint + records.
 * @returns Success outcome with the patched context.
 */
function commitResolvedEndpoint(
  ctx: IPipelineContext,
  internal: ITxnEndpointInternal,
): ITxnCommitOutcome {
  const accountIdCount = readAccountIdCount(ctx);
  const network = ctx.mediator.has ? ctx.mediator.value.network : undefined;
  const pool = network ? network.getAllEndpoints() : [];
  const harvest = buildTxnHarvest(internal, accountIdCount, pool);
  const updated = applyEndpointCommit(ctx, internal, harvest);
  logTxnEndpointCommitted(ctx, internal);
  logTxnHarvestCommitted(ctx, harvest);
  return { ok: true, ctx: updated, failure: EMPTY_COMMIT_FAILURE };
}

/**
 * Phase 7e — commit the resolved TXN endpoint to `ctx.txnEndpoint`,
 * or fail loud with `DASHBOARD_TXN_FIELDMAP_INCOMPLETE` when the
 * resolver cannot pick a date AND amount field. Mirrors the
 * ACCOUNT-RESOLVE.POST contract: every successful run either commits
 * the endpoint OR halts the pipeline before SCRAPE starts. The
 * MOCK_MODE valve preserves the offline snapshot suite — no captured
 * network traffic, no fail-loud applicable.
 *
 * @param ctx - Pipeline context after `maybeAttachApi`.
 * @returns Outcome carrying the updated context (success) or the
 *   fail-loud procedure to propagate.
 */
async function commitTxnEndpoint(ctx: IPipelineContext): Promise<ITxnCommitOutcome> {
  await Promise.resolve();
  if (!ctx.mediator.has) return buildBypassOutcome(ctx);
  if (isMockModeDashboardFinalActive) return buildBypassOutcome(ctx);
  const network = ctx.mediator.value.network;
  const internal = resolveTxnEndpoint(network);
  if (internal === false) return handleNoTxnEndpoint(ctx, network);
  return commitResolvedEndpoint(ctx, internal);
}

export {
  buildDropdownToggleSelector,
  executeCollectAndSignal,
  executeDashboardNavigationSealed,
  executePreLocateNav,
  executeValidateTraffic,
  findDropdownToggleCandidate,
  findFirstChildInDom,
  safeProbeDropdownToggleCount,
  safeProbeExactTextCount,
  tryDashboardSequentialNav,
};
