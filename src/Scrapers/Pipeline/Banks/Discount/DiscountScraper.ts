/**
 * Discount pipeline scraper — fetches accounts + transactions via discovered API.
 * Uses ctx.mediator.network to discover the gateway API base URL at runtime.
 * ZERO hardcoded endpoints — everything from network discovery.
 */

import moment from 'moment';

import { getDebug } from '../../../../Common/Debug.js';
import type { ITransaction, ITransactionsAccount } from '../../../../Transactions.js';
import { TransactionStatuses, TransactionTypes } from '../../../../Transactions.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import ScraperError from '../../../Base/ScraperError.js';
import { PIPELINE_WELL_KNOWN_API } from '../../Registry/PipelineWellKnown.js';
import type { IFetchStrategy } from '../../Strategy/FetchStrategy.js';
import { DEFAULT_FETCH_OPTS } from '../../Strategy/FetchStrategy.js';
import { some } from '../../Types/Option.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';

const LOG = getDebug('discount');

// ── Types ──────────────────────────────────────────────────

/** Scraped transaction from Discount API. */
interface IDiscountTxn {
  OperationNumber: number;
  OperationDate: string;
  ValueDate: string;
  OperationAmount: number;
  OperationDescriptionToDisplay: string;
}

/** Scraped accounts response from /userAccountsData. */
interface IDiscountAccountsRaw {
  UserAccountsData: {
    UserAccounts: { NewAccountInfo: { AccountID: string } }[];
  };
}

/** Scraped transactions response from /lastTransactions. */
interface IDiscountTxnRaw {
  Error?: { MsgText: string };
  CurrentAccountLastTransactions?: {
    OperationEntry: IDiscountTxn[] | null;
    CurrentAccountInfo: { AccountBalance: number };
    FutureTransactionsBlock: {
      FutureTransactionEntry: IDiscountTxn[] | null;
    };
  };
}

// ── Mappers ────────────────────────────────────────────────

/** Default date format for Discount API. */
const DATE_FORMAT = 'YYYYMMDD';

/** Empty transaction list. */
const EMPTY_TXNS: readonly ITransaction[] = [];

/**
 * Map one Discount transaction to ITransaction.
 * @param txn - Raw Discount transaction.
 * @param status - Completed or Pending.
 * @returns Mapped ITransaction.
 */
function mapOneTxn(txn: IDiscountTxn, status: TransactionStatuses): ITransaction {
  return {
    type: TransactionTypes.Normal,
    identifier: txn.OperationNumber,
    date: moment(txn.OperationDate, DATE_FORMAT).toISOString(),
    processedDate: moment(txn.ValueDate, DATE_FORMAT).toISOString(),
    originalAmount: txn.OperationAmount,
    originalCurrency: 'ILS',
    chargedAmount: txn.OperationAmount,
    description: txn.OperationDescriptionToDisplay,
    status,
  };
}

/**
 * Extract transactions from Discount API response.
 * @param raw - Raw API response.
 * @returns Array of mapped ITransactions.
 */
function mapTransactions(raw: IDiscountTxnRaw): readonly ITransaction[] {
  if (raw.Error) throw new ScraperError(`Discount API error: ${raw.Error.MsgText}`);
  const block = raw.CurrentAccountLastTransactions;
  if (!block) {
    LOG.warn('Discount API returned no CurrentAccountLastTransactions and no Error');
    return EMPTY_TXNS;
  }
  const completed = (block.OperationEntry ?? []).map(
    (t): ITransaction => mapOneTxn(t, TransactionStatuses.Completed),
  );
  const pending = (block.FutureTransactionsBlock.FutureTransactionEntry ?? []).map(
    (t): ITransaction => mapOneTxn(t, TransactionStatuses.Pending),
  );
  return [...completed, ...pending];
}

// ── Discovery-based fetch ──────────────────────────────────

/**
 * Extract API base from a captured URL using a marker path.
 * @param url - Full captured URL.
 * @param marker - Path marker to split on (e.g., '/userAccountsData').
 * @returns Base URL before the marker, or empty string.
 */
function extractBase(url: string, marker: string): string {
  const idx = url.indexOf(marker);
  if (idx <= 0) return '';
  return url.slice(0, idx);
}

/**
 * Discover the API base from captured traffic using WellKnown account patterns.
 * Uses PIPELINE_WELL_KNOWN_API.accounts to find the accounts endpoint.
 * @param ctx - Pipeline context with mediator.
 * @returns Discovered API base URL or failure.
 */
function discoverApiBase(ctx: IPipelineContext): Procedure<string> {
  if (!ctx.mediator.has) return fail(ScraperErrorTypes.Generic, 'No mediator');
  const network = ctx.mediator.value.network;
  const accountsHit = network.discoverByPatterns(PIPELINE_WELL_KNOWN_API.accounts);
  if (!accountsHit) return fail(ScraperErrorTypes.Generic, 'No accounts endpoint in traffic');
  const base = extractBase(accountsHit.url, '/userAccountsData');
  if (base) return succeed(base);
  const pathBase = extractBase(accountsHit.url, '/account');
  if (pathBase) return succeed(pathBase);
  return fail(ScraperErrorTypes.Generic, 'Could not extract API base from discovered endpoint');
}

/**
 * Fetch account IDs from Discount API.
 * @param strategy - Fetch strategy.
 * @param apiBase - Discovered API base URL.
 * @returns Array of account IDs.
 */
async function fetchAccounts(
  strategy: IFetchStrategy,
  apiBase: string,
): Promise<Procedure<readonly string[]>> {
  const url = `${apiBase}/userAccountsData`;
  const raw = await strategy.fetchGet<IDiscountAccountsRaw>(url, DEFAULT_FETCH_OPTS);
  if (!isOk(raw)) return raw;
  const ids = raw.value.UserAccountsData.UserAccounts.map(
    (a): string => a.NewAccountInfo.AccountID,
  );
  return succeed(ids);
}

/** Options for fetching one account's transactions. */
interface IAccountFetchOpts {
  readonly strategy: IFetchStrategy;
  readonly apiBase: string;
  readonly startDate: string;
}

/**
 * Build the lastTransactions URL for one account.
 * @param apiBase - Discovered API base.
 * @param accountId - Account number.
 * @param startDate - Formatted start date.
 * @returns Full URL with query params.
 */
function buildTxnUrl(apiBase: string, accountId: string, startDate: string): string {
  const params = [
    'IsCategoryDescCode=True',
    'IsTransactionDetails=True',
    'IsEventNames=True',
    'IsFutureTransactionFlag=True',
    `FromDate=${startDate}`,
  ].join('&');
  return `${apiBase}/lastTransactions/${accountId}/Date?${params}`;
}

/**
 * Fetch transactions for one account.
 * @param opts - Fetch options with strategy and API base.
 * @param accountId - Account number.
 * @returns Account with transactions and balance.
 */
async function fetchAccountTxns(
  opts: IAccountFetchOpts,
  accountId: string,
): Promise<Procedure<ITransactionsAccount>> {
  const url = buildTxnUrl(opts.apiBase, accountId, opts.startDate);
  const raw = await opts.strategy.fetchGet<IDiscountTxnRaw>(url, DEFAULT_FETCH_OPTS);
  if (!isOk(raw)) return raw;
  const txns = mapTransactions(raw.value);
  const bal = raw.value.CurrentAccountLastTransactions?.CurrentAccountInfo.AccountBalance ?? 0;
  const account: ITransactionsAccount = { accountNumber: accountId, balance: bal, txns: [...txns] };
  return succeed(account);
}

/**
 * Discount scrape — discovers API base from network, fetches all accounts.
 * @param ctx - Pipeline context.
 * @returns Updated context with scraped accounts.
 */
async function discountFetchData(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!ctx.fetchStrategy.has) return fail(ScraperErrorTypes.Generic, 'No fetchStrategy');
  const apiBaseResult = discoverApiBase(ctx);
  if (!isOk(apiBaseResult)) return apiBaseResult;
  const apiBase = apiBaseResult.value;
  LOG.debug('discovered API base: %s', apiBase);
  const strategy = ctx.fetchStrategy.value;
  const accountsResult = await fetchAccounts(strategy, apiBase);
  if (!isOk(accountsResult)) return accountsResult;
  const startDate = moment(ctx.options.startDate).format(DATE_FORMAT);
  const fetchOpts: IAccountFetchOpts = { strategy, apiBase, startDate };
  const fetches = accountsResult.value.map(
    (id): Promise<Procedure<ITransactionsAccount>> => fetchAccountTxns(fetchOpts, id),
  );
  const results = await Promise.all(fetches);
  const accounts = results.filter(isOk).map((r): ITransactionsAccount => r.value);
  return succeed({ ...ctx, scrape: some({ accounts }) });
}

export default discountFetchData;
export { discountFetchData };
