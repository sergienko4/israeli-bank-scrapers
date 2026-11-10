/**
 * ApiDirectScrape phase actions — Zero-Logic Bank Folder pattern.
 * Banks supply an IApiDirectScrapeShape (data only); this file drives the
 * customer → accounts → recovery flow and returns the scrape procedure.
 * Per-step helpers live in ApiDirectScrapeSteps.ts, the per-account walk in
 * ApiDirectScrapeAccountWalk.ts and row refinement in
 * ApiDirectScrapeAccountTxns.ts, keeping this file under the per-file LOC
 * ceiling. Zero bank-name coupling.
 */

import { isAuthRejectedFailure } from '../../Mediator/Api/ApiMediator.authReject.js';
import type { IApiMediator } from '../../Mediator/Api/ApiMediator.js';
import { resolveApiMediator } from '../../Mediator/Api/ApiMediatorAccessor.js';
import { isSome, some } from '../../Types/Option.js';
import type { IActionContext, IScrapeState } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, isTerminalFailure, preferTerminalFailure, succeed } from '../../Types/Procedure.js';
import type { IAccountResult } from './ApiDirectScrapeAccountWalk.js';
import { iterateAccounts } from './ApiDirectScrapeAccountWalk.js';
import runBootstrap from './ApiDirectScrapeBootstrap.js';
import { fetchAccounts } from './ApiDirectScrapeSteps.js';
import type { ApiDirectScrapeResult, IDriverCtx } from './ApiDirectScrapeTypes.js';
import type { IApiDirectScrapeShape } from './IApiDirectScrapeShape.js';

/**
 * Fold per-account results into the scrape slot, surfacing whether any
 * account's balance fetch fell back (the degraded warm-session signal a
 * shape's resultGuard inspects) and whether any account's backfill was
 * spent without covering the requested window.
 * @param results - Per-account results from the sequential walk.
 * @returns Scrape state with accounts + the two outcome flags.
 */
function summarizeScrape(results: readonly IAccountResult[]): IScrapeState {
  const flags = scrapeFlags(results);
  const observedCaveats = results.flatMap(r => r.observedCaveats);
  return { accounts: results.map(r => r.account), ...flags, observedCaveats };
}

/**
 * Fold the per-account outcome flags into the scrape-level ones.
 * @param results - Per-account results from the sequential walk.
 * @returns Degraded and backfill-exhausted flags.
 */
function scrapeFlags(
  results: readonly IAccountResult[],
): Pick<IScrapeState, 'balanceDegraded' | 'backfillExhausted'> {
  const isBalanceDegraded = results.some(r => r.degraded);
  const isBackfillExhausted = results.some(r => r.backfillExhausted);
  return { balanceDegraded: isBalanceDegraded, backfillExhausted: isBackfillExhausted };
}

/**
 * Run the bootstrap, then fetch the account list.
 * @param d - Driver context.
 * @returns Account refs procedure.
 */
async function preparedAccounts<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): Promise<Procedure<readonly TAcct[]>> {
  const primed = await runBootstrap(d);
  if (!isOk(primed)) return primed;
  return fetchAccounts(d);
}

/**
 * Publish the populated scrape slot beside the action context.
 * @param ctx - Action context.
 * @param results - Per-account results from the sequential walk.
 * @returns Action context augmented with the populated scrape slot.
 */
function scrapedResult(
  ctx: IActionContext,
  results: readonly IAccountResult[],
): Procedure<ApiDirectScrapeResult> {
  const scrape = summarizeScrape(results);
  const withScrape: ApiDirectScrapeResult = { ...ctx, scrape: some(scrape) };
  return succeed(withScrape);
}

/**
 * Run the scrape flow under a bound driver context.
 * @param d - Driver context.
 * @returns Action context augmented with the populated scrape slot.
 */
async function runScrape<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): Promise<Procedure<ApiDirectScrapeResult>> {
  const accts = await preparedAccounts(d);
  if (!isOk(accts)) return accts;
  const scraped = await iterateAccounts(d, accts.value);
  if (!isOk(scraped)) return scraped;
  return scrapedResult(d.ctx, scraped.value);
}

/**
 * Recognize a degraded scrape SLOT: a balance fallback fired OR the
 * authenticated call returned zero accounts.
 *
 * An empty-but-authenticated body is a known server-degraded warm-session
 * shape — the cached token still authenticates yet the backend silently
 * returns nothing. On the warm direct-API path this must count as suspicious so
 * self-heal can fire. The rule is bounded: recovery is warm-gated (see
 * {@link shouldRecoverSession}) and recover-once, so a direct-API account that
 * legitimately holds zero accounts re-runs at most once and then surfaces the
 * same empty result unmasked.
 * @param state - The populated scrape slot.
 * @returns True when the slot is empty or balance-degraded.
 */
function isDegradedScrapeState(state: IScrapeState): boolean {
  // Strict `=== true`: balanceDegraded is a validated boolean — never coerce.
  return state.accounts.length === 0 || state.balanceDegraded === true;
}

/**
 * Decide whether a scrape outcome warrants a session-recovery attempt: a hard
 * failure OR a degraded scrape slot (see {@link isDegradedScrapeState}).
 *
 * `balanceDegraded` is set by ANY balance fallback — including a transient 5xx
 * unrelated to the token — not only an auth-shaped rejection. This conflation
 * is DELIBERATE: a silently server-rejected warm token most reliably surfaces
 * as a balance fallback, and the blast radius is already bounded — recovery is
 * gated on a warm session (cold sessions never recover, see
 * {@link shouldRecoverSession}) and runs at most once (recover-once). Splitting
 * transient-vs-auth here would require threading the failure shape through
 * IBalanceOutcome, which the bank result guards consume with the current
 * any-fallback meaning. Worst case: one unnecessary OTP on a warm session that
 * hit a transient balance hiccup.
 * @param first - The first scrape procedure.
 * @returns True when the scrape failed or reported a degraded slot.
 */
function isScrapeSuspicious(first: Procedure<ApiDirectScrapeResult>): boolean {
  if (!isOk(first)) return true;
  const { scrape } = first.value;
  return isSome(scrape) && isDegradedScrapeState(scrape.value);
}

/**
 * Whether the bank rejected the session (401/403) somewhere in the scrape.
 * @param first - The first scrape procedure.
 * @returns True for an auth-rejected failure; false for a success.
 */
function isSessionRejected(first: Procedure<ApiDirectScrapeResult>): boolean {
  if (isOk(first)) return false;
  return isAuthRejectedFailure(first);
}

/**
 * Decide whether to recover; the two modes are exclusive. Under whole-scrape
 * recovery only a rejected session recovers, warm or cold, at a
 * bootstrap or a data call: a 5xx, a bank status, an incomplete session or a
 * degraded success stands. Otherwise recovery needs BOTH a suspicious outcome
 * AND a warm (cached-token) session: a cold session already ran the full login
 * flow, so recovering would only burn a second OTP, and a healthy warm session
 * needs no recovery. An edge (WAF) refusal never recovers: the bank never saw
 * the call, and a cold re-login could send an SMS OTP while the scrape host
 * stays blocked. Response-integrity refusals also stop recovery.
 * @param first - The first scrape procedure.
 * @param bus - The bound ApiMediator.
 * @returns True when recovery should run.
 */
function shouldRecoverSession(first: Procedure<ApiDirectScrapeResult>, bus: IApiMediator): boolean {
  if (isTerminalFailure(first)) return false;
  if (bus.recoversWholeScrape()) return isSessionRejected(first);
  return isScrapeSuspicious(first) && bus.wasSessionWarm();
}

/**
 * Run the scrape; when {@link shouldRecoverSession} says so, recover the
 * session (a cold re-login, or a re-grant under whole-scrape recovery) and
 * re-run the whole scrape, bootstrap included, once. A
 * failed recovery returns the first outcome unchanged so a loud failure or a
 * degraded result is never masked — unless recovery returned a terminal edge
 * or integrity refusal, which the earlier outcome would otherwise hide.
 * Shared by every api-direct bank with zero per-bank coupling.
 * @param d - Driver context.
 * @returns Scrape procedure (recovered when warranted).
 */
async function runScrapeWithRecovery<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): Promise<Procedure<ApiDirectScrapeResult>> {
  const first = await runScrape(d);
  if (!shouldRecoverSession(first, d.bus)) return first;
  const recovered = await d.bus.recoverSession();
  if (isOk(recovered)) return runScrape(d);
  return preferTerminalFailure(recovered, first);
}

/**
 * Factory — convert a bank shape into a scrape function.
 * @param shape - Bank-supplied shape declaration (data only).
 * @returns Scrape function consumed by the Pipeline descriptor.
 */
export function buildGenericHeadlessScrape<TAcct, TCursor>(
  shape: IApiDirectScrapeShape<TAcct, TCursor>,
): (ctx: IActionContext) => Promise<Procedure<ApiDirectScrapeResult>> {
  return async (ctx): Promise<Procedure<ApiDirectScrapeResult>> => {
    const busProc = resolveApiMediator(ctx, shape.stepName);
    if (!isOk(busProc)) return busProc;
    return runScrapeWithRecovery({ shape, bus: busProc.value, ctx });
  };
}

export default buildGenericHeadlessScrape;
