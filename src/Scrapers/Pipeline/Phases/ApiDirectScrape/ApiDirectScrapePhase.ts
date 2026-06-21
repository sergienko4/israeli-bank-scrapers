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
  ApiDirectScrapeResultGuard,
  IApiDirectScrapeShape,
  IApiDirectScrapeSummary,
} from './IApiDirectScrapeShape.js';

export type { ApiDirectScrapeFn, ApiDirectScrapeResult } from './ApiDirectScrapeTypes.js';

/** ApiDirectScrape phase — BasePhase bound to a shape literal. */
class ApiDirectScrapePhase extends BasePhase {
  public readonly name = 'api-direct-scrape' as const;
  private readonly _scrapeFn: ApiDirectScrapeFn;
  private readonly _resultGuard?: ApiDirectScrapeResultGuard;

  /**
   * Create the phase bound to a bank's shape literal.
   * @param scrapeFn - Bound scrape function from buildGenericHeadlessScrape.
   * @param resultGuard - Optional fail-closed guard (PayBox only).
   */
  constructor(scrapeFn: ApiDirectScrapeFn, resultGuard?: ApiDirectScrapeResultGuard) {
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
   * scrape, mirroring the legacy {@link ScrapePhase.post} hook.
   * Observability-only: no state mutation, no failure on empty.
   * Required because `pipeline.log` is the primary post-run debug
   * surface; without this line, root-causing bank issues forces a
   * re-run of the live E2E (SMS OTP, minutes of wall time).
   * @param _ctx - Unused incoming context.
   * @param input - Pipeline context after the scrape action.
   * @returns Input context unchanged, wrapped in a successful Procedure.
   */
  public post(
    _ctx: IPipelineContext,
    input: IPipelineContext,
  ): Promise<Procedure<IPipelineContext>> {
    input.logger.debug({ phase: this.name, message: 'api-direct-scrape.post' });
    if (input.scrape.has) logForensicAudit(input);
    const guarded = this.applyResultGuard(input);
    return Promise.resolve(guarded);
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

  /**
   * Fail-closed result guard — runs the bank's opt-in `resultGuard`
   * (PayBox only) against a PII-safe summary of the assembled scrape.
   * Banks that omit the hook return the input unchanged (byte-identical
   * behaviour). A guard failure short-circuits the phase in POST (FINAL
   * never runs) so a silently-degraded warm session can never surface
   * as an empty success.
   * @param input - Pipeline context after the forensic audit.
   * @returns Input unchanged, or the guard's typed failure.
   */
  private applyResultGuard(input: IPipelineContext): Procedure<IPipelineContext> {
    if (!this._resultGuard || !input.scrape.has) return succeed(input);
    const summary = summarizeScrape(input.scrape.value);
    const verdict = this._resultGuard(summary);
    if (!isOk(verdict)) return verdict;
    return succeed(input);
  }
}

/**
 * Summarise the assembled scrape for a bank's resultGuard: identity
 * count, total mapped txns, and whether the balance step degraded.
 * PII-safe — carries counts + a flag only, never account ids.
 * @param scrape - Populated scrape state.
 * @returns Guard summary.
 */
function summarizeScrape(scrape: IScrapeState): IApiDirectScrapeSummary {
  const totalTxns = scrape.accounts.reduce((sum, acc) => sum + acc.txns.length, 0);
  const isBalanceDegraded = scrape.balanceDegraded === true;
  return { accountCount: scrape.accounts.length, totalTxns, balanceDegraded: isBalanceDegraded };
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
