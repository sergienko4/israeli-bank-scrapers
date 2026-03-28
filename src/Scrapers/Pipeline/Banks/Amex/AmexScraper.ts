/**
 * Amex monthly transaction scraper — fetches full history via GetTransactionsList.
 * Uses MonthlyScrapeFactory for per-month iteration.
 * Card list comes from NetworkDiscovery (captured GetCardList during DashboardPhase).
 *
 * SOLID: extends the pipeline via .withScraper(), does NOT modify generic auto-scrape.
 */

import type { Moment } from 'moment';

import type { ITransactionsAccount } from '../../../../Transactions.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { autoMapTransaction, findFirstArray } from '../../Mediator/GenericScrapeStrategy.js';
import { createMonthlyScrapeFn } from '../../Phases/MonthlyScrapeFactory.js';
import { getDebug } from '../../Types/Debug.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';

const LOG = getDebug('amex-scraper');

/** Amex card from GetCardList response. */
interface IAmexCard {
  readonly cardSuffix: string;
  readonly companyCode: number;
  readonly isPartner: boolean;
  readonly isActive: boolean;
  readonly cardName: string;
}

/** Amex POST body for GetTransactionsList. */
interface IAmexTxnBody {
  readonly card4Number: string;
  readonly isNextBillingDate: boolean;
  readonly cardStatus: number;
  readonly billingMonth: string;
  readonly companyCode: number;
  readonly isPartner: boolean;
}

/** Bundled args for fetching one card × one month. */
interface ICardMonthArgs {
  readonly ctx: IPipelineContext;
  readonly txnUrl: string;
  readonly card: IAmexCard;
  readonly billingMonth: string;
}

/**
 * Extract active cards from the captured GetCardList response.
 * @param raw - Raw JSON from the accounts endpoint.
 * @returns Active IAmexCard array.
 */
function extractActiveCards(raw: Record<string, unknown>): readonly IAmexCard[] {
  const data = raw.data as Record<string, unknown> | undefined;
  if (!data) return [];
  const cardsList = data.cardsList as IAmexCard[] | undefined;
  if (!Array.isArray(cardsList)) return [];
  return cardsList.filter((c): boolean => c.isActive);
}

/**
 * Build the POST body for GetTransactionsList.
 * @param card - Active card from GetCardList.
 * @param billingMonth - Billing month string in DD/MM/YYYY format.
 * @returns POST body for the Amex V3 API.
 */
function buildAmexPostBody(card: IAmexCard, billingMonth: string): IAmexTxnBody {
  return {
    card4Number: card.cardSuffix,
    isNextBillingDate: false,
    cardStatus: 0,
    billingMonth,
    companyCode: card.companyCode,
    isPartner: card.isPartner,
  };
}

/**
 * Construct the transactions URL from the accounts endpoint URL.
 * @param accountsUrl - Discovered GetCardList URL.
 * @returns GetTransactionsList URL.
 */
function buildTxnUrl(accountsUrl: string): string {
  return accountsUrl
    .replace('statuspage', 'transactions')
    .replace('StatusPage', 'Transactions')
    .replace('GetCardList', 'GetTransactionsList');
}

/** Type alias for the raw Amex API response. */
type AmexApiResponse = Record<string, unknown>;
/** Type alias for a castable body param. */
type PostBody = Record<string, string | object>;

/**
 * Fetch transactions for one card × one month.
 * @param args - Bundled card + month + context arguments.
 * @returns Mapped transactions or empty on failure.
 */
async function fetchCardMonth(args: ICardMonthArgs): Promise<readonly ITransactionsAccount[]> {
  if (!args.ctx.api.has) return [];
  const body = buildAmexPostBody(args.card, args.billingMonth);
  const result = await args.ctx.api.value.fetchPost<AmexApiResponse>(
    args.txnUrl,
    body as unknown as PostBody,
  );
  if (!isOk(result)) return [];
  const items = findFirstArray(result.value);
  if (items.length === 0) return [];
  const records = items.map(i => i as Record<string, unknown>);
  const txns = records.map(autoMapTransaction);
  const last2 = args.card.cardSuffix.slice(-2);
  LOG.debug('card ****%s month %s: %d txns', last2, args.billingMonth, txns.length);
  const account: ITransactionsAccount = {
    accountNumber: args.card.cardSuffix,
    txns: [...txns],
  };
  return [account];
}

/**
 * Fetch all cards for one month recursively.
 * @param args - Base args (ctx, txnUrl, billingMonth).
 * @param cards - Remaining cards to process.
 * @param index - Current card index.
 * @returns All accounts for this month.
 */
async function fetchCardsRecursive(
  args: Omit<ICardMonthArgs, 'card'>,
  cards: readonly IAmexCard[],
  index: number,
): Promise<readonly ITransactionsAccount[]> {
  if (index >= cards.length) return [];
  const cardArgs: ICardMonthArgs = { ...args, card: cards[index] };
  const accounts = await fetchCardMonth(cardArgs);
  const rest = await fetchCardsRecursive(args, cards, index + 1);
  return [...accounts, ...rest];
}

/**
 * Build the getMonthTransactions callback for MonthlyScrapeFactory.
 * Discovers cards from the captured GetCardList, then iterates per card.
 * @param ctx - Pipeline context with mediator and api.
 * @param month - The billing month to fetch.
 * @returns Accounts for this month or failure.
 */
function amexGetMonthTransactions(
  ctx: IPipelineContext,
  month: Moment,
): Promise<Procedure<readonly ITransactionsAccount[]>> {
  if (!ctx.mediator.has) {
    const err = fail(ScraperErrorTypes.Generic, 'No mediator');
    return Promise.resolve(err);
  }
  const network = ctx.mediator.value.network;
  const accountsEndpoint = network.discoverAccountsEndpoint();
  if (!accountsEndpoint) {
    const err = fail(ScraperErrorTypes.Generic, 'No accounts endpoint');
    return Promise.resolve(err);
  }
  const rawBody = accountsEndpoint.responseBody as Record<string, unknown>;
  const cards = extractActiveCards(rawBody);
  if (cards.length === 0) {
    const err = fail(ScraperErrorTypes.Generic, 'No active cards');
    return Promise.resolve(err);
  }
  const txnUrl = buildTxnUrl(accountsEndpoint.url);
  const billingMonth = `01/${month.format('MM/YYYY')}`;
  const cardCount = String(cards.length);
  LOG.debug('fetching %s cards for %s', cardCount, billingMonth);
  const baseArgs = { ctx, txnUrl, billingMonth };
  return fetchCardsRecursive(baseArgs, cards, 0)
    .then((accounts): Procedure<readonly ITransactionsAccount[]> => succeed(accounts))
    .catch((): Procedure<readonly ITransactionsAccount[]> => succeed([]));
}

/** Amex monthly scrape function — compatible with PipelineBuilder.withScraper(). */
const AMEX_SCRAPE_FN = createMonthlyScrapeFn({
  defaultMonthsBack: 3,
  rateLimitMs: 500,
  getMonthTransactions: amexGetMonthTransactions,
});

export default AMEX_SCRAPE_FN;
export { AMEX_SCRAPE_FN, buildAmexPostBody, extractActiveCards };
export type { IAmexCard };
