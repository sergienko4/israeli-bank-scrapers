/**
 * Scrape phase — fetches accounts + transactions.
 * Supports three modes:
 *   1. GenericAutoScrape — no bank code: uses ctx.api + WellKnown field mapping
 *   2. IScrapeConfig — bank provides URLs + mappers, executor does fetch
 *   3. CustomScrapeFn — bank provides full function
 */

import moment from 'moment';

import type { ITransactionsAccount } from '../../../Transactions.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import {
  extractAccountIds,
  extractTransactions,
  findFieldValue,
} from '../Mediator/GenericScrapeStrategy.js';
import type { INetworkDiscovery } from '../Mediator/NetworkDiscovery.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../Registry/PipelineWellKnown.js';
import { some } from '../Types/Option.js';
import type { IPipelineStep } from '../Types/Phase.js';
import type { IApiFetchContext, IPipelineContext } from '../Types/PipelineContext.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, isOk, succeed } from '../Types/Procedure.js';
import type { CustomScrapeFn, IScrapeConfig } from '../Types/ScrapeConfig.js';
import { executeScrape } from './ScrapeExecutor.js';

// ── Generic Auto-Scrape (ZERO bank code) ─────────────────

/**
 * Fetch accounts from discovered endpoint, extract IDs via WellKnown.
 * @param api - Auto-injected API fetch context.
 * @returns Array of account IDs.
 */
async function genericFetchAccounts(api: IApiFetchContext): Promise<Procedure<readonly string[]>> {
  if (!api.accountsUrl) return fail(ScraperErrorTypes.Generic, 'No accounts URL');
  const raw = await api.fetchGet<Record<string, unknown>>(api.accountsUrl);
  if (!isOk(raw)) return raw;
  const ids = extractAccountIds(raw.value);
  return succeed(ids);
}

/**
 * Fetch balance for one account from discovered balance URL.
 * @param api - API fetch context.
 * @param network - Network discovery for URL building.
 * @param accountId - Account number.
 * @returns Balance number or 0.
 */
async function genericFetchBalance(
  api: IApiFetchContext,
  network: INetworkDiscovery,
  accountId: string,
): Promise<number> {
  const balUrl = network.buildBalanceUrl(accountId);
  if (!balUrl) return 0;
  const raw = await api.fetchGet<Record<string, unknown>>(balUrl);
  if (!isOk(raw)) return 0;
  const bal = findFieldValue(raw.value, WK.balance);
  if (typeof bal === 'number') return bal;
  return 0;
}

/** Bundled context for fetching one account's data. */
interface IAccountFetchCtx {
  readonly api: IApiFetchContext;
  readonly network: INetworkDiscovery;
  readonly startDate: string;
}

/**
 * Resolve the transaction URL for an account — template or fallback.
 * @param fc - Account fetch context.
 * @param accountId - Account number.
 * @returns Transaction URL or false.
 */
function resolveTxnUrl(fc: IAccountFetchCtx, accountId: string): string | false {
  const fromTemplate = fc.network.buildTransactionUrl(accountId, fc.startDate);
  if (fromTemplate) return fromTemplate;
  return fc.api.transactionsUrl;
}

/**
 * Fetch transactions for one account using URL template from traffic.
 * @param fc - Bundled fetch context.
 * @param accountId - Account number.
 * @returns Mapped account with transactions + balance.
 */
async function genericFetchOneAccount(
  fc: IAccountFetchCtx,
  accountId: string,
): Promise<Procedure<ITransactionsAccount>> {
  const fetchUrl = resolveTxnUrl(fc, accountId);
  if (!fetchUrl) return fail(ScraperErrorTypes.Generic, 'No txn URL');
  const raw = await fc.api.fetchGet<Record<string, unknown>>(fetchUrl);
  if (!isOk(raw)) return raw;
  const txns = extractTransactions(raw.value);
  const balance = await genericFetchBalance(fc.api, fc.network, accountId);
  return succeed({ accountNumber: accountId, balance, txns: [...txns] });
}

/**
 * Generic auto-scrape — uses ctx.api + network discovery + WellKnown.
 * Banks provide ZERO code. The mediator discovers everything.
 * @param ctx - Pipeline context with ctx.api injected by DASHBOARD.
 * @returns Updated context with scraped accounts.
 */
async function genericAutoScrape(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!ctx.api.has) return succeed(ctx);
  if (!ctx.mediator.has) return succeed(ctx);
  const api = ctx.api.value;
  const network = ctx.mediator.value.network;
  const startDate = moment(ctx.options.startDate).format('YYYYMMDD');
  const accountsResult = await genericFetchAccounts(api);
  if (!isOk(accountsResult)) return accountsResult;
  const fc: IAccountFetchCtx = { api, network, startDate };
  const fetches = accountsResult.value.map(
    (id): Promise<Procedure<ITransactionsAccount>> => genericFetchOneAccount(fc, id),
  );
  const results = await Promise.all(fetches);
  const accounts = results.filter(isOk).map((r): ITransactionsAccount => r.value);
  return succeed({ ...ctx, scrape: some({ accounts }) });
}

// ── Step factories ───────────────────────────────────────

/**
 * Create a scrape step from an IScrapeConfig (generic mode).
 * @param config - The bank's scrape configuration.
 * @returns A pipeline step that fetches and maps transactions.
 */
function createConfigScrapeStep<TA, TT>(
  config: IScrapeConfig<TA, TT>,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  const step: IPipelineStep<IPipelineContext, IPipelineContext> = {
    name: 'scrape',
    /** @inheritdoc */
    execute: (_ctx, input): Promise<Procedure<IPipelineContext>> => executeScrape(input, config),
  };
  return step;
}

/**
 * Create a scrape step from a custom function (edge case mode).
 * @param scrapeFn - The bank's custom scrape function.
 * @returns A pipeline step for scraping.
 */
function createCustomScrapeStep(
  scrapeFn: CustomScrapeFn,
): IPipelineStep<IPipelineContext, IPipelineContext> {
  const step: IPipelineStep<IPipelineContext, IPipelineContext> = {
    name: 'scrape',
    /** @inheritdoc */
    execute: (_ctx, input): Promise<Procedure<IPipelineContext>> => scrapeFn(input),
  };
  return step;
}

/**
 * Default scrape — auto-discovers accounts + transactions via ctx.api + WellKnown.
 * Banks with ZERO custom scraper use this automatically.
 * @param _ctx - Unused.
 * @param input - Pipeline context with ctx.api.
 * @returns Updated context with scraped accounts.
 */
function autoScrapeExecute(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  return genericAutoScrape(input);
}

/** Default auto-scrape step — uses WellKnown when no custom scraper provided. */
const SCRAPE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'scrape',
  execute: autoScrapeExecute,
};

export type { CustomScrapeFn } from '../Types/ScrapeConfig.js';
export default SCRAPE_STEP;
export { createConfigScrapeStep, createCustomScrapeStep, genericAutoScrape, SCRAPE_STEP };
