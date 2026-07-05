/**
 * AccountResolveActions.Nudge — robust multi-tier cards-view nudge.
 *
 * <p>When passive discovery yields no id-bearing capture, a same-URL SPA
 * (Isracard / Amex) must be driven to its cards view so a
 * navigation-gated accounts API (e.g. Isracard `GetCardList`) finally
 * fires and its capture lands in the pre-nav pool POST reads.
 *
 * <p>A single click is brittle: the transactions link can sit behind a
 * collapsed menu, or share its visible text with a login-redirect decoy.
 * This walks escalating, self-contained recovery tiers and stops at the
 * first one that makes an accounts-API capture appear:
 * <ol>
 *   <li>tier 1 — click the visible transactions link directly;
 *   <li>tier 2 — expand the collapsed menu, then click the link;
 *   <li>tier 3 — navigate to a discovered transactions-page href
 *       (rejecting cross-origin and login-redirect decoy hrefs).
 * </ol>
 * Every tier is best-effort: a brittle DOM never crashes the pipeline.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { isTxnPageUrl } from '../../Registry/WK/DashboardTxnMatch.js';
import { WK_DASHBOARD } from '../../Registry/WK/DashboardWK.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';

/** Click timeout (ms) for a single nudge interaction. */
const NUDGE_CLICK_TIMEOUT_MS = 5000;
/** Confirmation window (ms) for an accounts capture to appear after a tier. */
const ACCOUNTS_WAIT_MS = 4000;
/** Account-list URL patterns owned locally to avoid a Scrape-WK dependency. */
const ACCOUNTS_PATTERNS = [
  /userAccountsData/i,
  /account\/init/i,
  /account\/info/i,
  /\/Init$/i,
  /GetCOLMetadata/i,
  /accountSummary/i,
  /GetCardList/i,
] as const satisfies readonly RegExp[];
/** Well-known transactions-link candidates. */
const TRANSACTIONS_GROUP = WK_DASHBOARD.TRANSACTIONS;
/** Well-known menu-expand candidates (cast mirrors Dashboard call sites). */
const MENU_EXPAND_GROUP = WK_DASHBOARD.MENU_EXPAND as unknown as readonly SelectorCandidate[];

/** Bundled args — structurally compatible with Wait's `IAwaitArgs`. */
interface INudgeArgs {
  readonly mediator: IElementMediator;
  readonly log: IPipelineContext['logger'];
}

/** One recovery tier — resolves true once it surfaces accounts traffic. */
type NudgeTier = (args: INudgeArgs) => Promise<boolean>;

/**
 * Click a well-known candidate group, best-effort.
 * @param mediator - Element mediator.
 * @param group - Candidate selector list.
 * @returns True when the click resolved to a found element.
 */
async function clickGroup(
  mediator: IElementMediator,
  group: readonly SelectorCandidate[],
): Promise<boolean> {
  const result = await mediator.resolveAndClick(group, NUDGE_CLICK_TIMEOUT_MS);
  return result.success && result.value.found;
}

/**
 * Probe whether an accounts-API capture has landed in the pool.
 * @param mediator - Element mediator.
 * @returns True when an accounts capture appears within the window.
 */
async function accountsTrafficSeen(mediator: IElementMediator): Promise<boolean> {
  const seen = await mediator.network.waitForTraffic(ACCOUNTS_PATTERNS, ACCOUNTS_WAIT_MS);
  return seen !== false;
}

/**
 * Tier 1 — click the visible transactions link directly.
 * @param args - Nudge args.
 * @returns True when accounts traffic followed the click.
 */
async function tierDirectClick(args: INudgeArgs): Promise<boolean> {
  if (!(await clickGroup(args.mediator, TRANSACTIONS_GROUP))) return false;
  return accountsTrafficSeen(args.mediator);
}

/**
 * Tier 2 — expand the collapsed menu, then click the now-visible link.
 * @param args - Nudge args.
 * @returns True when accounts traffic followed the expand + click.
 */
async function tierExpandThenClick(args: INudgeArgs): Promise<boolean> {
  if (!(await clickGroup(args.mediator, MENU_EXPAND_GROUP))) return false;
  if (!(await clickGroup(args.mediator, TRANSACTIONS_GROUP))) return false;
  return accountsTrafficSeen(args.mediator);
}

/**
 * Test whether a URL protocol is http or https.
 * @param protocol - URL protocol including the trailing colon.
 * @returns True for `http:` / `https:`.
 */
function isHttpProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:';
}

/**
 * Parse an href into an absolute, same-origin http(s) URL.
 *
 * <p>Default-deny: an href harvested from the live DOM is untrusted
 * input, so the resolved URL must be http(s) AND share the base page's
 * origin. This blocks a cross-origin decoy (e.g. an injected
 * `https://evil.example/ocp/transactions`) from driving the tier-3
 * navigation away from the authenticated session.
 * @param href - Raw href (absolute or relative).
 * @param base - Current page URL used to resolve relatives.
 * @returns Absolute same-origin http(s) URL, or '' when unsafe.
 */
function parseHttpUrl(href: string, base: string): string {
  const baseUrl = new URL(base);
  const candidate = new URL(href, baseUrl);
  const isSafe = isHttpProtocol(candidate.protocol) && candidate.origin === baseUrl.origin;
  return isSafe ? candidate.href : '';
}

/**
 * Resolve an href to a safe absolute same-origin http(s) URL, never
 * throwing.
 * @param href - Raw href (absolute or relative).
 * @param base - Current page URL used to resolve relatives.
 * @returns Absolute same-origin http(s) URL, or '' when unsafe /
 *   unparseable.
 */
function toSafeHttpUrl(href: string, base: string): string {
  try {
    return parseHttpUrl(href, base);
  } catch {
    return '';
  }
}

/**
 * Scan a raw href list for the first entry that both matches the
 * transactions-page pattern and resolves to a safe same-origin http(s)
 * URL. Iterating all candidates means a cross-origin or unparseable href
 * appearing earlier never silently blocks a valid later one.
 * @param hrefs - Raw href list from the live page.
 * @param base - Current page URL for same-origin validation.
 * @returns Absolute same-origin txn-page URL, or '' when none qualifies.
 */
function resolveFirstSafeTxnHref(hrefs: readonly string[], base: string): string {
  const safe = hrefs
    .filter(isTxnPageUrl)
    .map(h => toSafeHttpUrl(h, base))
    .find(u => u !== '');
  return safe ?? '';
}

/**
 * Collect all page hrefs and return the first that resolves to a safe
 * same-origin txn-page URL.
 * @param mediator - Element mediator.
 * @returns Absolute same-origin txn-page URL, or '' when none qualifies.
 */
async function resolveTxnUrl(mediator: IElementMediator): Promise<string> {
  const base = mediator.getCurrentUrl();
  const hrefs = await mediator.collectAllHrefs();
  return resolveFirstSafeTxnHref(hrefs, base);
}

/**
 * Tier 3 — navigate directly to a discovered transactions-page href.
 * Rejects non-txn hrefs (e.g. login redirects) so a same-text decoy
 * never drives the navigation.
 * @param args - Nudge args.
 * @returns True when accounts traffic followed the navigation.
 */
async function tierHrefNavigate(args: INudgeArgs): Promise<boolean> {
  const url = await resolveTxnUrl(args.mediator);
  if (url === '') return false;
  const navigated = await args.mediator.navigateTo(url);
  if (!navigated.success) return false;
  return accountsTrafficSeen(args.mediator);
}

/** Ordered recovery tiers — first to surface accounts traffic wins (OCP). */
const NUDGE_TIERS: readonly NudgeTier[] = [tierDirectClick, tierExpandThenClick, tierHrefNavigate];

/**
 * Run a single tier, swallowing any throw so a brittle DOM never crashes
 * the pipeline (best-effort recovery).
 * @param tier - Tier to run.
 * @param args - Nudge args.
 * @returns The tier's result, or false on throw.
 */
async function runTier(tier: NudgeTier, args: INudgeArgs): Promise<boolean> {
  try {
    return await tier(args);
  } catch {
    return false;
  }
}

/** Bundled state for the recursive tier walk. */
interface IWalkArgs {
  readonly args: INudgeArgs;
  readonly index: number;
}

/**
 * Walk the tiers in order, stopping at the first that surfaces accounts
 * traffic.
 * @param walk - Nudge args + current tier index.
 * @returns True when a tier surfaced accounts traffic; false when all
 *   tiers are exhausted without success.
 */
async function walkNudgeTiers(walk: IWalkArgs): Promise<boolean> {
  const isExhausted = walk.index >= NUDGE_TIERS.length;
  if (isExhausted) return false;
  const didSurface = await runTier(NUDGE_TIERS[walk.index], walk.args);
  if (didSurface) return true;
  return walkNudgeTiers({ args: walk.args, index: walk.index + 1 });
}

/**
 * Drive a same-URL SPA to its cards view via escalating recovery tiers so
 * a navigation-gated accounts API finally fires. Best-effort: every tier
 * is isolated and the walk never throws.
 * @param args - Bundled mediator + logger.
 * @returns True when a tier surfaced accounts traffic; false otherwise.
 */
async function nudgeToCardsView(args: INudgeArgs): Promise<boolean> {
  args.log.debug({ message: 'account-resolve.pre nudge → drive cards view' });
  return walkNudgeTiers({ args, index: 0 });
}

export type { INudgeArgs, NudgeTier };
export { nudgeToCardsView };
