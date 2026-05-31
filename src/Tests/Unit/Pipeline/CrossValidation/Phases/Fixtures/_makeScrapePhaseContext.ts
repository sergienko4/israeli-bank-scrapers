/**
 * Phase H.T3c.9 — fixture-driven IPipelineContext builder for the
 * cross-bank SCRAPE per-phase factory.
 *
 * <p>POST contract (per `ScrapePhaseActions.ts:375-391`): succeeds
 * when `ctx.scrape.accounts` has >= 1 account AND at least one
 * account has >= 1 txn. Fails loud `scrape.post: all N accounts
 * have 0 txns — scrape miss` when every account is empty.
 *
 * <p>FINAL contract (per `ScrapePhaseActions.ts:483+`): stamps
 * account count, always succeeds (audit trail only).
 *
 * <p>The helper takes a fixture-supplied accounts array and stamps
 * it onto `ctx.scrape` so POST+FINAL run against captured-shape
 * scraper output without needing to replay the upstream
 * fetchStrategy + URL/transaction harvest chain (those are
 * exercised by the Phase G cross-bank dedup factory).
 */

import { some } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { ITransactionsAccount } from '../../../../../../Transactions.js';
import { makeMockContext } from '../../../Infrastructure/MockFactories.js';

/** Result of {@link buildScrapePhaseContext} — POST+FINAL replay-ready. */
export interface IScrapePhaseTestSubject {
  readonly context: IPipelineContext;
}

/** Bundled arguments for {@link buildScrapePhaseContext}. */
export interface IScrapePhaseContextArgs {
  readonly accounts: readonly ITransactionsAccount[];
}

/**
 * Build a SCRAPE-stage test subject from a fixture. Stamps the
 * fixture's accounts array onto `ctx.scrape` so SCRAPE.POST's
 * "all-accounts-empty" guard runs against the bank's captured-shape
 * scrape output.
 *
 * @param args - Bundled arguments (accounts).
 * @returns Context ready for SCRAPE.POST + FINAL replay.
 */
export function buildScrapePhaseContext(args: IScrapePhaseContextArgs): IScrapePhaseTestSubject {
  const { accounts } = args;
  const base = makeMockContext();
  const scrapeOutput = some({ accounts });
  return { context: { ...base, scrape: scrapeOutput } };
}
