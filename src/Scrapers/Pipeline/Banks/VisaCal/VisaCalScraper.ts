/**
 * VisaCal scrape logic — all fetches via ctx.fetchStrategy.
 * Rewritten from scratch for the pipeline architecture.
 * Zero imports from old VisaCal code.
 */

import moment from 'moment';
import type { Page } from 'playwright-core';

import { filterOldTransactions } from '../../../../Common/Transactions.js';
import type { ITransaction, ITransactionsAccount } from '../../../../Transactions.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../Base/Interface.js';
import type { IBankScraperConfig } from '../../../Registry/Config/ScraperConfigDefaults.js';
import type { IFetchOpts, IFetchStrategy } from '../../Strategy/FetchStrategy.js';
import { some } from '../../Types/Option.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import {
  type IRawPendingTxn,
  type IRawTxn,
  mapCompleted,
  mapPendingResults,
} from './VisaCalMappers.js';

/** Resolved endpoint URLs from ctx.config. */
interface IEndpoints {
  readonly initUrl: string;
  readonly framesUrl: string;
  readonly txnUrl: string;
  readonly pendingUrl: string;
  readonly xSiteId: string;
  readonly calOrigin: string;
}

/**
 * Resolve VisaCal API endpoints from bank config.
 * @param api - Bank API config from ctx.config.
 * @returns Resolved endpoint URLs.
 */
function resolveEndpoints(api: IBankScraperConfig['api']): IEndpoints {
  const endpoints: IEndpoints = {
    initUrl: api.calInit ?? '',
    framesUrl: api.calFrames ?? '',
    txnUrl: api.calTransactions ?? '',
    pendingUrl: api.calPending ?? '',
    xSiteId: api.calXSiteId ?? '',
    calOrigin: api.calOrigin ?? '',
  };
  return endpoints;
}

// ── Types (defined fresh) ──────────────────────────────────

/** Bundled fetch dependencies — strategy + headers + endpoints. */
interface IFetchCtx {
  readonly strategy: IFetchStrategy;
  readonly opts: IFetchOpts;
  readonly ep: IEndpoints;
}

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

// Types + mappers extracted to VisaCalMappers.ts

// ── Headers ────────────────────────────────────────────────

/**
 * Build API headers.
 * @param authorization - Auth token string.
 * @param ep - Resolved endpoints with site ID and origin.
 * @returns IFetchOpts with all required headers.
 */
function buildOpts(authorization: string, ep: IEndpoints): IFetchOpts {
  const extraHeaders = {
    authorization,
    'X-Site-Id': ep.xSiteId,
    'Content-Type': 'application/json',
    Origin: ep.calOrigin,
    Referer: ep.calOrigin,
  };
  const opts: IFetchOpts = { extraHeaders };
  return opts;
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
 * @returns Procedure with authorization header string, or failure.
 */
/**
 * Parse calConnectToken from raw auth-module JSON.
 * @param raw - Raw JSON string from sessionStorage.
 * @returns Procedure with token string, or failure on parse/missing.
 */
function parseAuthToken(raw: string): Procedure<string> {
  try {
    const parsed = JSON.parse(raw) as IAuthShape;
    const token = parsed.auth?.calConnectToken ?? '';
    return succeed(token);
  } catch {
    return fail(ScraperErrorTypes.Generic, 'Malformed auth-module JSON');
  }
}

/**
 * Get VisaCal auth header from page sessionStorage.
 * @param page - The Playwright page with active session.
 * @returns Procedure with authorization header string, or failure.
 */
async function getAuth(page: Page): Promise<Procedure<string>> {
  const raw = await page.evaluate((): string => {
    const stored = sessionStorage.getItem('auth-module');
    return stored ?? '';
  });
  if (!raw) return fail(ScraperErrorTypes.Generic, 'No auth-module in sessionStorage');
  const tokenResult = parseAuthToken(raw);
  if (!isOk(tokenResult)) return tokenResult;
  if (!tokenResult.value)
    return fail(ScraperErrorTypes.Generic, 'No calConnectToken in auth-module');
  return succeed(`CALAuthScheme ${tokenResult.value}`);
}

// ── Fetch via strategy ─────────────────────────────────────

/** /init response. */
interface IInitResp {
  readonly result: { readonly cards: readonly ICard[] };
}

/**
 * Fetch cards from /init.
 * @param fc - Fetch context (strategy + headers + endpoints).
 * @returns Card list procedure.
 */
async function fetchCards(fc: IFetchCtx): Promise<Procedure<readonly ICard[]>> {
  const body = { tokenGuid: '' };
  const raw = await fc.strategy.fetchPost<IInitResp>(fc.ep.initUrl, body as never, fc.opts);
  if (!isOk(raw)) return raw;
  const mapped = raw.value.result.cards.map(
    (c): ICard => ({
      cardUniqueId: c.cardUniqueId,
      last4Digits: c.last4Digits,
    }),
  );
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
 * @param fc - Fetch context (strategy + headers + endpoints).
 * @param cards - Card list for request body.
 * @returns Card frames procedure.
 */
async function fetchFrames(
  fc: IFetchCtx,
  cards: readonly ICard[],
): Promise<Procedure<readonly ICardFrame[]>> {
  const ids = cards.map((c): { cardUniqueId: string } => ({ cardUniqueId: c.cardUniqueId }));
  const body = { cardsForFrameData: ids };
  const raw = await fc.strategy.fetchPost<IFramesResp>(fc.ep.framesUrl, body as never, fc.opts);
  if (!isOk(raw)) return raw;
  const frames = raw.value.result?.bankIssuedCards?.cardLevelFrames ?? [];
  return succeed(frames);
}

// Transaction mappers extracted to VisaCalMappers.ts

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

/** A single debit date entry with transactions. */
interface IDebitDate {
  readonly transactions: readonly IRawTxn[];
}

/** Bundled fetch context for one card's monthly fetch. */
interface IMonthFetchCtx {
  readonly fc: IFetchCtx;
  readonly card: ICard;
}

/**
 * Fetch one month of transactions.
 * @param ctx - Month fetch context.
 * @param month - Month moment.
 * @returns Procedure with raw transactions or failure.
 */
async function fetchOneMonth(
  ctx: IMonthFetchCtx,
  month: moment.Moment,
): Promise<Procedure<readonly IRawTxn[]>> {
  const body = {
    cardUniqueId: ctx.card.cardUniqueId,
    month: month.format('M'),
    year: month.format('YYYY'),
  };
  const url = ctx.fc.ep.txnUrl;
  const raw = await ctx.fc.strategy.fetchPost<ITxnResp>(url, body as never, ctx.fc.opts);
  if (!isOk(raw)) return raw;
  const banks = raw.value.result.bankAccounts;
  const debits = banks.flatMap((b): readonly IDebitDate[] => b.debitDates);
  const immediates = banks.flatMap((b): readonly IDebitDate[] => b.immidiateDebits.debitDays);
  const txns = [...debits, ...immediates].flatMap((d): readonly IRawTxn[] => d.transactions);
  return succeed(txns);
}

/** Empty month result — base case for recursion. */
const EMPTY_MONTHS: IMonthsResult = { txns: [], warnings: [] };

/** Accumulated result from multi-month fetch with soft failures. */
interface IMonthsResult {
  readonly txns: readonly IRawTxn[];
  readonly warnings: readonly string[];
}

/**
 * Fetch all months recursively — soft fail per month.
 * On month failure: logs warning, continues with remaining months.
 * @param ctx - Month fetch context.
 * @param months - Month array.
 * @param index - Current index.
 * @returns Accumulated transactions and warnings.
 */
async function fetchMonthsRecursive(
  ctx: IMonthFetchCtx,
  months: readonly moment.Moment[],
  index: number,
): Promise<IMonthsResult> {
  if (index >= months.length) return EMPTY_MONTHS;
  const monthResult = await fetchOneMonth(ctx, months[index]);
  const rest = await fetchMonthsRecursive(ctx, months, index + 1);
  if (!isOk(monthResult)) {
    const label = months[index].format('YYYY-MM');
    const warning = `Month ${label} fetch failed: ${monthResult.errorMessage}`;
    const withWarning: IMonthsResult = { txns: rest.txns, warnings: [warning, ...rest.warnings] };
    return withWarning;
  }
  const allTxns = [...monthResult.value, ...rest.txns];
  const merged: IMonthsResult = { txns: allTxns, warnings: rest.warnings };
  return merged;
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
 * @param fc - Fetch context (strategy + headers + endpoints).
 * @param card - Card info.
 * @returns Procedure with pending transactions or failure.
 */
async function fetchPending(
  fc: IFetchCtx,
  card: ICard,
): Promise<Procedure<readonly IRawPendingTxn[]>> {
  const body = { cardUniqueIDArray: [card.cardUniqueId] };
  const raw = await fc.strategy.fetchPost<IPendingResp>(fc.ep.pendingUrl, body as never, fc.opts);
  if (!isOk(raw)) return raw;
  if (!raw.value.result) return succeed([]);
  const cards = raw.value.result.cardsList;
  const txns = cards.flatMap((c): readonly IRawPendingTxn[] => c.authDetalisList);
  return succeed(txns);
}

// ── Card assembly ──────────────────────────────────────────

/** Bundled context for one card fetch. */
interface ICardCtx {
  readonly fc: IFetchCtx;
  readonly months: readonly moment.Moment[];
  readonly frames: readonly ICardFrame[];
  readonly options: ScraperOptions;
}

/** Result from one card fetch — account + any warnings. */
interface ICardResult {
  readonly account: ITransactionsAccount;
  readonly warnings: readonly string[];
}

/**
 * Resolve pending transactions — soft fail returns [] with warning.
 * @param fc - Fetch context.
 * @param card - Card info.
 * @returns Pending transactions and optional warning.
 */
async function resolvePending(
  fc: IFetchCtx,
  card: ICard,
): Promise<{ txns: ITransaction[]; warning: string }> {
  const pendingResult = await fetchPending(fc, card);
  const mapped = mapPendingResults(pendingResult);
  if (isOk(mapped)) return { txns: mapped.value, warning: '' };
  const msg = `Pending failed: ${mapped.errorMessage}`;
  return { txns: [], warning: msg };
}

/**
 * Fetch and map one card's data. Soft fail: pending failure is a warning, not fatal.
 * @param card - Card info.
 * @param ctx - Card context.
 * @returns Card result with account and any warnings.
 */
async function fetchOneCard(card: ICard, ctx: ICardCtx): Promise<ICardResult> {
  const monthCtx: IMonthFetchCtx = { fc: ctx.fc, card };
  const monthsResult = await fetchMonthsRecursive(monthCtx, ctx.months, 0);
  const pendingInfo = await resolvePending(ctx.fc, card);
  const completed: ITransaction[] = monthsResult.txns.map(mapCompleted);
  const allTxns: ITransaction[] = [...completed, ...pendingInfo.txns];
  const isCombine = ctx.options.shouldCombineInstallments ?? false;
  const startMoment = moment(ctx.options.startDate);
  const filtered = filterOldTransactions(allTxns, startMoment, isCombine);
  const frame = ctx.frames.find((f): boolean => f.cardUniqueId === card.cardUniqueId);
  const balance = frame?.nextTotalDebit ?? 0;
  const account: ITransactionsAccount = {
    accountNumber: card.last4Digits,
    balance,
    txns: filtered,
  };
  const warnings = [...monthsResult.warnings];
  if (pendingInfo.warning) warnings.push(pendingInfo.warning);
  const result: ICardResult = { account, warnings };
  return result;
}

// ── Public scrape function ─────────────────────────────────

/**
 * Build month range from start to now + future months.
 * @param start - Start moment.
 * @param futureMonths - Extra future months.
 * @returns Month array.
 */
function buildMonths(start: moment.Moment, futureMonths: number): readonly moment.Moment[] {
  const startMonth = start.clone().startOf('month');
  const endMonth = moment().add(futureMonths, 'month').startOf('month');
  const count = endMonth.diff(startMonth, 'months');
  return Array.from(
    { length: count + 1 },
    (_, i): moment.Moment => startMonth.clone().add(i, 'months'),
  );
}

/** Bundled API deps for building card context. */
interface IApiDeps {
  readonly fc: IFetchCtx;
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
  const cardCtx: ICardCtx = {
    fc: deps.fc,
    months,
    frames: deps.frames,
    options: ctx.options,
  };
  return cardCtx;
}

/**
 * Fetch all cards in parallel, collecting warnings.
 * @param cards - Card list.
 * @param cardCtx - Card fetch context.
 * @returns Accounts and accumulated warnings.
 */
async function fetchAllCards(
  cards: readonly ICard[],
  cardCtx: ICardCtx,
): Promise<{ accounts: readonly ITransactionsAccount[]; warnings: readonly string[] }> {
  const fetches = cards.map((c): Promise<ICardResult> => fetchOneCard(c, cardCtx));
  const results = await Promise.all(fetches);
  const accounts = results.map((r): ITransactionsAccount => r.account);
  const warnings = results.flatMap((r): readonly string[] => r.warnings);
  return { accounts, warnings };
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
  const authResult = await getAuth(page);
  if (!isOk(authResult)) return authResult;
  const ep = resolveEndpoints(ctx.config.api);
  const opts = buildOpts(authResult.value, ep);
  const strategy = ctx.fetchStrategy.value;
  const fc: IFetchCtx = { strategy, opts, ep };
  const cardsResult = await fetchCards(fc);
  if (!isOk(cardsResult)) return cardsResult;
  const framesResult = await fetchFrames(fc, cardsResult.value);
  if (!isOk(framesResult)) return framesResult;
  const deps: IApiDeps = { fc, frames: framesResult.value };
  const cardCtx = buildCardCtx(ctx, deps);
  const cardResults = await fetchAllCards(cardsResult.value, cardCtx);
  const prevWarnings = ctx.diagnostics.warnings;
  const allWarnings = [...prevWarnings, ...cardResults.warnings];
  const diag = { ...ctx.diagnostics, warnings: allWarnings };
  const accounts = cardResults.accounts;
  return succeed({ ...ctx, diagnostics: diag, scrape: some({ accounts }) });
}

export { buildMonths, getAuth, visaCalFetchData };
