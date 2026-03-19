/**
 * VisaCal scrape logic — all fetches via ctx.fetchStrategy.
 * Rewritten from scratch for the pipeline architecture.
 * Zero imports from old VisaCal code.
 */

import moment from 'moment';
import type { Page } from 'playwright-core';

import { filterOldTransactions } from '../../../Common/Transactions.js';
import { CompanyTypes } from '../../../Definitions.js';
import {
  type ITransaction,
  type ITransactionsAccount,
  TransactionStatuses,
  TransactionTypes,
} from '../../../Transactions.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { ScraperOptions } from '../../Base/Interface.js';
import type { IFetchOpts, IFetchStrategy } from '../../Pipeline/Strategy/FetchStrategy.js';
import { some } from '../../Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../Pipeline/Types/Procedure.js';
import { fail, isOk, succeed } from '../../Pipeline/Types/Procedure.js';
import { SCRAPER_CONFIGURATION } from '../../Registry/Config/ScraperConfig.js';

const CFG = SCRAPER_CONFIGURATION.banks[CompanyTypes.VisaCal];

// ── Endpoints ──────────────────────────────────────────────
const INIT_URL = CFG.api.calInit ?? '';
const FRAMES_URL = CFG.api.calFrames ?? '';
const TXN_URL = CFG.api.calTransactions ?? '';
const PENDING_URL = CFG.api.calPending ?? '';
const X_SITE_ID = CFG.api.calXSiteId ?? '';
const CAL_ORIGIN = CFG.api.calOrigin ?? '';

// ── Types (defined fresh) ──────────────────────────────────

/** Card from /init. */
interface ICard {
  readonly cardUniqueId: string;
  readonly last4Digits: string;
}

/** Frame balance from /frames. */
interface ICardFrame {
  readonly cardUniqueId: string;
  readonly nextTotalDebit: number;
}

/** Completed transaction from /transactions. */
interface IRawTxn {
  readonly trnIntId: string;
  readonly trnPurchaseDate: string;
  readonly debCrdDate: string;
  readonly trnAmt: number;
  readonly amtBeforeConvAndIndex: number;
  readonly trnCurrencySymbol: string;
  readonly debCrdCurrencySymbol: string;
  readonly merchantName: string;
  readonly transTypeCommentDetails: string;
  readonly branchCodeDesc: string;
  readonly trnTypeCode: number;
  readonly numOfPayments: number;
  readonly curPaymentNum: number;
}

/** Pending transaction from /pending. */
interface IRawPendingTxn {
  readonly trnPurchaseDate: string;
  readonly trnAmt: number;
  readonly trnCurrencySymbol: string;
  readonly merchantName: string;
  readonly transTypeCommentDetails: string;
  readonly branchCodeDesc: string;
  readonly trnTypeCode: number;
  readonly numberOfPayments: number;
}

/** Type codes. */
const TRN_REGULAR = 5;
const TRN_CREDIT = 6;
const TRN_STANDING = 9;

// ── Headers ────────────────────────────────────────────────

/**
 * Build API headers.
 * @param authorization - Auth token string.
 * @returns IFetchOpts with all required headers.
 */
function buildOpts(authorization: string): IFetchOpts {
  return {
    extraHeaders: {
      authorization,
      'X-Site-Id': X_SITE_ID,
      'Content-Type': 'application/json',
      Origin: CAL_ORIGIN,
      Referer: CAL_ORIGIN,
    },
  };
}

/**
 * Get auth token from sessionStorage.
 * @param page - Browser page.
 * @returns Authorization header string.
 */
/** Parsed sessionStorage auth shape. */
interface IAuthShape {
  auth?: { calConnectToken?: string };
}

/**
 * Get auth token from sessionStorage.
 * @param page - Browser page.
 * @returns Authorization header string.
 */
async function getAuth(page: Page): Promise<string> {
  const raw = await page.evaluate((): string => {
    const stored = sessionStorage.getItem('auth-module');
    return stored ?? '';
  });
  if (!raw) return '';
  const parsed = JSON.parse(raw) as IAuthShape;
  const auth = parsed.auth;
  const token = auth ? (auth.calConnectToken ?? '') : '';
  return `CALAuthScheme ${token}`;
}

// ── Fetch via strategy ─────────────────────────────────────

/** /init response. */
interface IInitResp {
  readonly result: { readonly cards: readonly ICard[] };
}

/**
 * Fetch cards from /init.
 * @param strategy - Fetch strategy.
 * @param opts - Headers.
 * @returns Card list procedure.
 */
async function fetchCards(
  strategy: IFetchStrategy,
  opts: IFetchOpts,
): Promise<Procedure<readonly ICard[]>> {
  const body = { tokenGuid: '' };
  const raw = await strategy.fetchPost<IInitResp>(INIT_URL, body as never, opts);
  if (!isOk(raw)) return raw;
  const mapped = raw.value.result.cards.map(c => ({
    cardUniqueId: c.cardUniqueId,
    last4Digits: c.last4Digits,
  }));
  return succeed(mapped);
}

/** /frames response. */
interface IFramesResp {
  readonly result?: {
    readonly bankIssuedCards?: {
      readonly cardLevelFrames?: readonly ICardFrame[];
    };
  };
}

/**
 * Fetch frames (balances) from /frames.
 * @param strategy - Fetch strategy.
 * @param opts - Headers.
 * @param cards - Card list for request body.
 * @returns Card frames procedure.
 */
async function fetchFrames(
  strategy: IFetchStrategy,
  opts: IFetchOpts,
  cards: readonly ICard[],
): Promise<Procedure<readonly ICardFrame[]>> {
  const ids = cards.map(c => ({ cardUniqueId: c.cardUniqueId }));
  const body = { cardsForFrameData: ids };
  const raw = await strategy.fetchPost<IFramesResp>(FRAMES_URL, body as never, opts);
  if (!isOk(raw)) return raw;
  const frames = raw.value.result?.bankIssuedCards?.cardLevelFrames ?? [];
  return succeed(frames);
}

// ── Transaction mapping ────────────────────────────────────

/**
 * Map completed transaction amounts.
 * @param txn - Raw completed transaction.
 * @returns Amount fields for ITransaction.
 */
function mapCompletedAmounts(txn: IRawTxn): Pick<ITransaction, 'originalAmount' | 'chargedAmount'> {
  const isCredit = txn.trnTypeCode === TRN_CREDIT;
  return {
    originalAmount: txn.trnAmt * (isCredit ? 1 : -1),
    chargedAmount: txn.amtBeforeConvAndIndex * -1,
  };
}

/**
 * Map a completed transaction.
 * @param txn - Raw transaction from API.
 * @returns Mapped ITransaction.
 */
function mapCompleted(txn: IRawTxn): ITransaction {
  const isNormal = txn.trnTypeCode === TRN_REGULAR || txn.trnTypeCode === TRN_STANDING;
  const amounts = mapCompletedAmounts(txn);
  return {
    identifier: txn.trnIntId,
    type: isNormal ? TransactionTypes.Normal : TransactionTypes.Installments,
    status: TransactionStatuses.Completed,
    date: moment(txn.trnPurchaseDate).toISOString(),
    processedDate: new Date(txn.debCrdDate).toISOString(),
    ...amounts,
    originalCurrency: txn.trnCurrencySymbol,
    chargedCurrency: txn.debCrdCurrencySymbol,
    description: txn.merchantName,
    memo: txn.transTypeCommentDetails,
    category: txn.branchCodeDesc,
    installments: txn.numOfPayments
      ? { number: txn.curPaymentNum, total: txn.numOfPayments }
      : undefined,
  };
}

/**
 * Map a pending transaction.
 * @param txn - Raw pending transaction.
 * @returns Mapped ITransaction.
 */
function mapPending(txn: IRawPendingTxn): ITransaction {
  const date = moment(txn.trnPurchaseDate).toISOString();
  return {
    type: TransactionTypes.Normal,
    status: TransactionStatuses.Pending,
    date,
    processedDate: date,
    originalAmount: txn.trnAmt * -1,
    originalCurrency: txn.trnCurrencySymbol,
    chargedAmount: txn.trnAmt * -1,
    description: txn.merchantName,
    memo: txn.transTypeCommentDetails,
    category: txn.branchCodeDesc,
  };
}

// ── Monthly fetch ──────────────────────────────────────────

/** /transactions response. */
interface ITxnResp {
  readonly statusCode: number;
  readonly result: {
    readonly bankAccounts: readonly {
      readonly debitDates: readonly { readonly transactions: readonly IRawTxn[] }[];
      readonly immidiateDebits: {
        readonly debitDays: readonly { readonly transactions: readonly IRawTxn[] }[];
      };
    }[];
  };
}

/** Bundled fetch context for one card. */
interface IMonthFetchCtx {
  readonly strategy: IFetchStrategy;
  readonly opts: IFetchOpts;
  readonly card: ICard;
}

/**
 * Fetch one month of transactions.
 * @param ctx - Month fetch context.
 * @param month - Month moment.
 * @returns Raw transactions for the month.
 */
async function fetchOneMonth(
  ctx: IMonthFetchCtx,
  month: moment.Moment,
): Promise<readonly IRawTxn[]> {
  const body = {
    cardUniqueId: ctx.card.cardUniqueId,
    month: month.format('M'),
    year: month.format('YYYY'),
  };
  const raw = await ctx.strategy.fetchPost<ITxnResp>(TXN_URL, body as never, ctx.opts);
  if (!isOk(raw)) return [];
  const banks = raw.value.result.bankAccounts;
  const debits = banks.flatMap(b => b.debitDates);
  const immediates = banks.flatMap(b => b.immidiateDebits.debitDays);
  return [...debits, ...immediates].flatMap(d => d.transactions);
}

/**
 * Fetch all months recursively.
 * @param ctx - Month fetch context.
 * @param months - Month array.
 * @param index - Current index.
 * @returns All raw transactions.
 */
async function fetchMonthsRecursive(
  ctx: IMonthFetchCtx,
  months: readonly moment.Moment[],
  index: number,
): Promise<readonly IRawTxn[]> {
  if (index >= months.length) return [];
  const txns = await fetchOneMonth(ctx, months[index]);
  const rest = await fetchMonthsRecursive(ctx, months, index + 1);
  return [...txns, ...rest];
}

// ── Pending fetch ──────────────────────────────────────────

/** /pending response. */
interface IPendingResp {
  readonly statusCode: number;
  readonly result?: {
    readonly cardsList: readonly {
      readonly authDetalisList: readonly IRawPendingTxn[];
    }[];
  };
}

/**
 * Fetch pending transactions for a card.
 * @param strategy - Fetch strategy.
 * @param opts - Headers.
 * @param card - Card info.
 * @returns Pending transactions.
 */
async function fetchPending(
  strategy: IFetchStrategy,
  opts: IFetchOpts,
  card: ICard,
): Promise<readonly IRawPendingTxn[]> {
  const body = { cardUniqueIDArray: [card.cardUniqueId] };
  const raw = await strategy.fetchPost<IPendingResp>(PENDING_URL, body as never, opts);
  if (!isOk(raw)) return [];
  if (!raw.value.result) return [];
  return raw.value.result.cardsList.flatMap(c => c.authDetalisList);
}

// ── Card assembly ──────────────────────────────────────────

/** Bundled context for one card fetch. */
interface ICardCtx {
  readonly strategy: IFetchStrategy;
  readonly opts: IFetchOpts;
  readonly months: readonly moment.Moment[];
  readonly frames: readonly ICardFrame[];
  readonly options: ScraperOptions;
}

/**
 * Fetch and map one card's data.
 * @param card - Card info.
 * @param ctx - Card context.
 * @returns Account with transactions.
 */
async function fetchOneCard(card: ICard, ctx: ICardCtx): Promise<ITransactionsAccount> {
  const monthCtx: IMonthFetchCtx = { strategy: ctx.strategy, opts: ctx.opts, card };
  const rawTxns = await fetchMonthsRecursive(monthCtx, ctx.months, 0);
  const rawPending = await fetchPending(ctx.strategy, ctx.opts, card);
  const completed = rawTxns.map(mapCompleted);
  const pending = rawPending.map(mapPending);
  const allTxns = [...completed, ...pending];
  const isCombine = ctx.options.shouldCombineInstallments ?? false;
  const startMoment = moment(ctx.options.startDate);
  const filtered = filterOldTransactions(allTxns, startMoment, isCombine);
  const frame = ctx.frames.find(f => f.cardUniqueId === card.cardUniqueId);
  const balance = frame?.nextTotalDebit ?? 0;
  return { accountNumber: card.last4Digits, balance, txns: filtered };
}

// ── Public scrape function ─────────────────────────────────

/**
 * Build month range from start to now + future months.
 * @param start - Start moment.
 * @param futureMonths - Extra future months.
 * @returns Month array.
 */
function buildMonths(start: moment.Moment, futureMonths: number): readonly moment.Moment[] {
  const final = moment().add(futureMonths, 'month');
  const count = final.diff(start, 'months');
  return Array.from({ length: count + 1 }, (_, i) => final.clone().subtract(i, 'months'));
}

/** Bundled API deps for building card context. */
interface IApiDeps {
  readonly strategy: IFetchStrategy;
  readonly opts: IFetchOpts;
  readonly frames: readonly ICardFrame[];
}

/**
 * Build card fetch context from API results.
 * @param ctx - Pipeline context.
 * @param deps - Strategy, headers, and frames.
 * @returns Card context for per-card fetching.
 */
function buildCardCtx(ctx: IPipelineContext, deps: IApiDeps): ICardCtx {
  const defaultStart = moment().subtract(18, 'months').add(1, 'day');
  const userStart = moment(ctx.options.startDate);
  const start = moment.max(defaultStart, userStart);
  const futureMonths = ctx.options.futureMonthsToScrape ?? 0;
  const months = buildMonths(start, futureMonths);
  return {
    strategy: deps.strategy,
    opts: deps.opts,
    months,
    frames: deps.frames,
    options: ctx.options,
  };
}

/**
 * VisaCal scrape — all fetches through strategy.
 * @param ctx - Pipeline context.
 * @returns Updated context with accounts.
 */
async function visaCalFetchData(ctx: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!ctx.browser.has || !ctx.fetchStrategy.has) {
    return fail(ScraperErrorTypes.Generic, 'Missing browser or strategy');
  }
  const page = ctx.browser.value.page;
  const authorization = await getAuth(page);
  const opts = buildOpts(authorization);
  const strategy = ctx.fetchStrategy.value;

  const cardsResult = await fetchCards(strategy, opts);
  if (!isOk(cardsResult)) return cardsResult;
  const framesResult = await fetchFrames(strategy, opts, cardsResult.value);
  if (!isOk(framesResult)) return framesResult;

  const deps: IApiDeps = { strategy, opts, frames: framesResult.value };
  const cardCtx = buildCardCtx(ctx, deps);
  const fetches = cardsResult.value.map(c => fetchOneCard(c, cardCtx));
  const accounts = await Promise.all(fetches);
  return succeed({ ...ctx, scrape: some({ accounts }) });
}

export { getAuth, visaCalFetchData };
