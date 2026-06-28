/**
 * ApiDirectScrape phase — post-login data fetch via the configured
 * IApiDirectScrapeShape. The phase is a thin orchestration wrapper:
 * the real work (customer → per-account balance + paginated txns,
 * row mapping, context merge) lives in ApiDirectScrapeActions so
 * the per-file LOC ceiling is respected.
 *
 * Zero bank-name coupling per Rule #11. The bank's SHAPE config
 * is supplied by the PipelineBuilder via withApiDirect(CALL, SHAPE)
 * which wires this phase into the chain in place of the legacy
 * SCRAPE phase + custom action exec. The phase name
 * `api-direct-scrape` is registered in NO_RETRY_PHASES so the
 * sanitization pulse will not re-invoke real API calls on failure.
 */

import { logForensicAudit } from '../../Mediator/Scrape/ForensicAuditAction.js';
import { BasePhase } from '../../Types/BasePhase.js';
import { some } from '../../Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
  IScrapeState,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { buildGenericHeadlessScrape } from './ApiDirectScrapeActions.js';
import type { ApiDirectScrapeFn } from './ApiDirectScrapeTypes.js';
import type {
  IApiDirectScrapeGuardSummary,
  IApiDirectScrapeShape,
} from './IApiDirectScrapeShape.js';

export type { ApiDirectScrapeFn, ApiDirectScrapeResult } from './ApiDirectScrapeTypes.js';

/** Result-guard fn — a shape may convert a degraded scrape into a failure. */
type ResultGuardFn = (summary: IApiDirectScrapeGuardSummary) => Procedure<void>;

/** ApiDirectScrape phase — BasePhase bound to a shape literal. */
class ApiDirectScrapePhase extends BasePhase {
  public readonly name = 'api-direct-scrape' as const;
  private readonly _scrapeFn: ApiDirectScrapeFn;
  private readonly _resultGuard?: ResultGuardFn;

  /**
   * Create the phase bound to a bank's shape literal.
   * @param scrapeFn - Bound scrape function from buildGenericHeadlessScrape.
   * @param resultGuard - Optional fail-closed guard run in POST.
   */
  constructor(scrapeFn: ApiDirectScrapeFn, resultGuard?: ResultGuardFn) {
    super();
    this._scrapeFn = scrapeFn;
    this._resultGuard = resultGuard;
  }

  /** @inheritdoc */
  public async action(
    _ctx: IActionContext,
    input: IActionContext,
  ): Promise<Procedure<IActionContext>> {
    return this._scrapeFn(input);
  }

  /**
   * POST stage — emit the forensic-audit summary so the per-account
   * txn-count line lands in `pipeline.log` for every api-direct
   * scrape, mirroring the legacy {@link ScrapePhase.post} hook, then
   * run the shape's optional fail-closed {@link ResultGuardFn}.
   * Observability + guard only: no state mutation. When the shape
   * supplies no guard the stage always succeeds; when it does, a
   * degraded/empty scrape is converted into a loud typed failure
   * (e.g. PayBox zero-txns from a degraded warm session) instead of
   * a silent empty result. Required because `pipeline.log` is the
   * primary post-run debug surface; without this line, root-causing
   * bank issues forces a re-run of the live E2E (SMS OTP, minutes of
   * wall time).
   * @param _ctx - Unused incoming context.
   * @param input - Pipeline context after the scrape action.
   * @returns Input unchanged on success, or the guard's typed failure.
   */
  public post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'api-direct-scrape.post' });
    if (input.scrape.has) logForensicAudit(input);
    const outcome = runResultGuard(input, this._resultGuard);
    return Promise.resolve(outcome);
  }

  /**
   * FINAL stage — emit `ctx.balanceResolution` directly from the
   * per-account balances the bank's IApiDirectScrapeShape already
   * populated on `scrape.accounts[i].balance`. PipelineResult then
   * reads a single source (balanceResolution) regardless of which
   * scrape path ran (BALANCE-RESOLVE vs api-direct).
   *
   * <p>v6 single-source contract: every browser bank's
   * BALANCE-RESOLVE.final emits balanceResolution; every api-direct
   * bank's api-direct-scrape.final does the same here, so the
   * result-builder reads one field unconditionally (no legacy
   * fallback needed once both paths are wired).
   *
   * @param _ctx - Unused incoming context.
   * @param input - Pipeline context after .post.
   * @returns Input + balanceResolution committed.
   */
  public final(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'api-direct-scrape.final' });
    const next = emitBalanceResolutionFromScrape(input);
    return Promise.resolve(next);
  }
}

/**
 * Run the optional shape result-guard against the post-scrape context.
 * Converts a degraded/empty scrape into a loud typed failure when the
 * guard says so; otherwise passes the context through unchanged.
 * Hoisted so `this` is not implicated (class-methods-use-this).
 *
 * @param input - Pipeline context after the scrape action.
 * @param guard - Optional shape-supplied result guard.
 * @returns Guard failure, or the input wrapped in success.
 */
function runResultGuard(
  input: IPipelineContext,
  guard?: ResultGuardFn,
): Procedure<IPipelineContext> {
  if (guard === undefined || !input.scrape.has) return succeed(input);
  const summary = summarizeScrapeForGuard(input.scrape.value);
  const verdict = guard(summary);
  if (!isOk(verdict)) return verdict;
  return succeed(input);
}

/**
 * Fold the scrape slice into the PII-free summary a shape inspects:
 * account count, total transactions, and whether any account's balance
 * fetch fell back (the degraded-warm-session signal).
 *
 * @param scrape - Scrape state committed by the action.
 * @returns Summary consumed by a shape's resultGuard.
 */
function summarizeScrapeForGuard(scrape: IScrapeState): IApiDirectScrapeGuardSummary {
  const accountCount = scrape.accounts.length;
  const totalTxns = scrape.accounts.reduce((n, a) => n + a.txns.length, 0);
  const hasDegraded = scrape.balanceDegraded ?? false;
  return { accountCount, totalTxns, balanceDegraded: hasDegraded };
}

/**
 * Build the balanceResolution map (if scrape state is present) and
 * commit it to the context. Hoisted out of the class so `this` is
 * not implicated (class-methods-use-this).
 *
 * @param input - Pipeline context after .post.
 * @returns Procedure wrapping input + balanceResolution committed.
 */
function emitBalanceResolutionFromScrape(input: IPipelineContext): Procedure<IPipelineContext> {
  if (!input.scrape.has) return succeed(input);
  const balanceResolution = buildBalanceMapFromScrape(input.scrape.value);
  const next = { ...input, balanceResolution: some(balanceResolution) };
  return succeed(next);
}

/**
 * Build the per-account balance map from the api-direct shape's own
 * per-account balance fields. One entry per `accounts[i].accountNumber`
 * **whose `balance` is a real number** — missing balances are skipped so
 * PipelineResult's downstream lookup falls back to the legacy SCRAPE
 * balance, distinguishing "unknown" from a real zero. Default-deny per
 * coding-principle-guidlines §4.
 *
 * @param scrape - Scrape state populated by the api-direct action.
 * @returns Per-account balance map (only known balances).
 */
function buildBalanceMapFromScrape(scrape: IScrapeState): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const acc of scrape.accounts) commitIfKnownBalance(out, acc);
  return out;
}

/**
 * Hoisted helper so {@link buildBalanceMapFromScrape} stays at depth 1
 * (max-depth lint rule). Only commits when `acc.balance` is a real
 * number; missing balances are skipped so PipelineResult can fall back
 * to the legacy SCRAPE value.
 *
 * @param out - Balance map being built.
 * @param acc - Scrape account record.
 * @returns True when the entry was committed.
 */
function commitIfKnownBalance(
  out: Map<string, number>,
  acc: IScrapeState['accounts'][number],
): boolean {
  if (typeof acc.balance !== 'number') return false;
  out.set(acc.accountNumber, acc.balance);
  return true;
}

/**
 * Bind a SHAPE to the ApiDirectScrape phase, returning the bound
 * function the legacy pipeline executor invokes per scrape run.
 *
 * @param shape - Bank-supplied shape declaration (data only).
 * @returns Phase function that performs the scrape against the
 *   supplied shape and emits the structured trace events.
 */
function createApiDirectScrapePhase<TAcct, TCursor>(
  shape: IApiDirectScrapeShape<TAcct, TCursor>,
): ApiDirectScrapeFn {
  return buildGenericHeadlessScrape(shape);
}

/**
 * Build an ApiDirectScrape BasePhase bound to a shape literal.
 * Used by PipelineBuilder.withApiDirect(call, shape) to wire the phase
 * into the chain. The resulting phase carries name
 * `api-direct-scrape` so NO_RETRY_PHASES suppresses sanitization
 * pulse retries.
 *
 * @param shape - Bank-supplied shape declaration (data only).
 * @returns BasePhase instance with name 'api-direct-scrape'.
 */
function buildApiDirectScrapePhase<TAcct, TCursor>(
  shape: IApiDirectScrapeShape<TAcct, TCursor>,
): ApiDirectScrapePhase {
  const fn = buildGenericHeadlessScrape(shape);
  return Reflect.construct(ApiDirectScrapePhase, [fn, shape.resultGuard]);
}

export default createApiDirectScrapePhase;
export { ApiDirectScrapePhase, buildApiDirectScrapePhase, createApiDirectScrapePhase };
