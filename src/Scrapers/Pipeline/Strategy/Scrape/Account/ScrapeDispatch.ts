/**
 * Account dispatch + iteration — routes each account to POST or GET strategy.
 * Billing in ScrapeBillingHelpers.ts, strategies in ScrapePostHelpers.ts.
 */

import type { ITransactionsAccount } from '../../../../../Transactions.js';
import type { IDiscoveredEndpoint } from '../../../Mediator/Network/NetworkDiscovery.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { isOk } from '../../../Types/Procedure.js';
import type {
  ApiPayload,
  IAccountFetchCtx,
  IAccountFetchOpts,
  IFetchAllAccountsCtx,
} from '../ScrapeTypes.js';
import { scrapeOneAccountPost, scrapeOneAccountViaUrl } from './AccountScrapeStrategy.js';

export { tryBufferedResponse } from './AccountScrapeStrategy.js';

/** Account index in sequential iteration. */
type AccountIndex = number;

/**
 * Check if options indicate a POST endpoint is available.
 * @param opts - Account fetch options.
 * @returns True if POST endpoint with account record exists.
 */
function hasPostEndpoint(opts: IAccountFetchOpts): opts is IAccountFetchOpts & {
  readonly accountRecord: ApiPayload;
  readonly txnEndpoint: IDiscoveredEndpoint;
} {
  if (!opts.txnEndpoint) return false;
  if (opts.txnEndpoint.method !== 'POST') return false;
  return Boolean(opts.accountRecord);
}

/**
 * Dispatch one account to the appropriate strategy.
 * @param fc - Fetch context.
 * @param accountId - Account number.
 * @param opts - Account record and endpoint.
 * @returns Account with transactions.
 */
async function dispatchOneAccount(
  fc: IAccountFetchCtx,
  accountId: string,
  opts: IAccountFetchOpts,
): Promise<Procedure<ITransactionsAccount>> {
  if (!hasPostEndpoint(opts)) return scrapeOneAccountViaUrl(fc, accountId);
  return scrapeOneAccountPost(fc, opts.accountRecord, opts.txnEndpoint);
}

/**
 * Process one account (loop body helper).
 * @param ctx - Fetch-all context.
 * @param index - Current account index.
 * @param out - Accumulator.
 * @returns True when processed.
 */
async function processOneAccount(
  ctx: IFetchAllAccountsCtx,
  index: number,
  out: ITransactionsAccount[],
): Promise<true> {
  const opts: IAccountFetchOpts = {
    accountRecord: ctx.records[index],
    txnEndpoint: ctx.txnEndpoint,
  };
  const result = await dispatchOneAccount(ctx.fc, ctx.ids[index], opts);
  if (isOk(result)) out.push(result.value);
  return true as const;
}

/**
 * Build index array for sequential account iteration.
 * @param count - Number of accounts.
 * @returns Array of indices [0, 1, 2, ...].
 */
function indexArray(count: number): readonly AccountIndex[] {
  return Array.from({ length: count }, (_, i): AccountIndex => i);
}

/**
 * Scrape all accounts via sequential promise chain.
 * @param ctx - Bundled fetch-all context.
 * @returns Scraped accounts array.
 */
async function scrapeAllAccounts(
  ctx: IFetchAllAccountsCtx,
): Promise<readonly ITransactionsAccount[]> {
  const accounts: ITransactionsAccount[] = [];
  const indices = indexArray(ctx.ids.length);
  const seed = Promise.resolve(true as const);
  await indices.reduce(
    (prev, idx): Promise<true> =>
      prev.then((): Promise<true> => processOneAccount(ctx, idx, accounts)),
    seed,
  );
  return accounts;
}

export default scrapeAllAccounts;
export { scrapeAllAccounts };
