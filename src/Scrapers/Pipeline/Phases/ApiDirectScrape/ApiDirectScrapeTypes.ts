/**
 * ApiDirectScrape shared types — extracted so ApiDirectScrapeActions and
 * ApiDirectScrapePhase both depend on this leaf module instead of each
 * other, breaking the Actions<->Phase import cycle.
 *
 * <p>The step contexts live here for the same reason: every module that builds
 * or receives one can import it without pulling in the dispatch-args builders,
 * which keeps the urlTag resolvers from depending back on them.
 */

import type { IApiMediator } from '../../Mediator/Api/ApiMediator.js';
import type { IEvidenceLedger } from '../../Mediator/Scrape/CoverageAudit/EvidenceLedger.js';
import type { IActionContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import type { IApiDirectScrapeShape } from './IApiDirectScrapeShape.js';

/** Context returned by the shape-driven scrape function, `scrape` slot committed. */
export type ApiDirectScrapeResult = IActionContext;

/** Bound phase action — the shape-driven scrape function. */
export type ApiDirectScrapeFn = (ctx: IActionContext) => Promise<Procedure<ApiDirectScrapeResult>>;

/** Driver context — shape + bus + action context. */
export interface IDriverCtx<TAcct, TCursor> {
  readonly shape: IApiDirectScrapeShape<TAcct, TCursor>;
  readonly bus: IApiMediator;
  readonly ctx: IActionContext;
}

/** Per-account context — driver context + current account. */
export interface IAcctCtx<TAcct, TCursor> extends IDriverCtx<TAcct, TCursor> {
  readonly acct: TAcct;
  /**
   * Where this account's guardrails report what they saw.
   *
   * One per account, never shared. Required rather than optional so a new
   * call site that forgets to open one is a compile error rather than an
   * account whose evidence silently vanishes.
   */
  readonly ledger: IEvidenceLedger;
}
