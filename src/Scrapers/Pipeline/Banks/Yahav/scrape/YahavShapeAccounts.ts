/**
 * Yahav native scrape shape — the accounts and balance reads (spec §10.2).
 * Both post to the multiplexed BaNCS account route with the session state.
 * The accounts read lists the portfolio's current ILS accounts; the balance
 * read answers the matched account's CURRENT figure. A missing or
 * non-numeric figure is reported absent, never coerced to zero, and a failed
 * balance read fails the scrape rather than inventing a figure.
 */

import type { ApiRecord } from '../../../Mediator/Scrape/AutoMapperFacade/AutoMapperTypes.js';
import { getIn, isCurrentBalType, isRecord } from '../../../Mediator/Scrape/Bancs/BancsShape.js';
import type {
  ApiBody,
  IApiDirectScrapeBalanceStep,
  IApiDirectScrapeCustomerStep,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { YAHAV_BANCS_PATHS as PATHS } from '../../../Registry/Config/PipelineBankConfigYahavConstants.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import {
  countYahavAccounts,
  extractYahavAccounts,
  isYahavAccountOf,
  yahavEntities,
} from './YahavAccountExtract.js';
import { yahavAccountsPayload } from './YahavNativePayloads.js';
import { yahavBalancePayload } from './YahavNativePayloadsAccount.js';
import { yahavReadHeaders, yahavReadVars } from './YahavShapeCall.js';
import { type IYahavAcct, yahavCallUrl, yahavPortfolioOf } from './YahavShapeHelpers.js';

/** The multiplexed route the accounts, balance and transaction reads post to. */
const YAHAV_ACCOUNT_URL = yahavCallUrl(PATHS.account);

/** The headers every account-route read sends. */
const YAHAV_ACCOUNT_HEADERS = yahavReadHeaders(PATHS.account);

/** A decimal amount as BaNCS sends it in text. */
const DECIMAL = /^[+-]?\d+(?:\.\d+)?$/;

/**
 * The accounts read body for the bootstrap's portfolio.
 * @param ctx - Action context.
 * @returns Read body.
 */
function accountsVars(ctx: IActionContext): VarsMap {
  const portfolio = yahavPortfolioOf(ctx);
  const payload = yahavAccountsPayload(portfolio);
  return yahavReadVars(ctx, PATHS.account, payload);
}

/**
 * The balance read body for one account.
 * @param acct - The account.
 * @param ctx - Action context.
 * @returns Read body.
 */
function balanceVars(acct: IYahavAcct, ctx: IActionContext): VarsMap {
  const portfolio = yahavPortfolioOf(ctx);
  const payload = yahavBalancePayload({ portfolio, account: acct });
  return yahavReadVars(ctx, PATHS.account, payload);
}

/**
 * The balance rows of the entity naming the account.
 * @param body - Balance answer body.
 * @param acct - The account.
 * @returns Balance rows, empty when no entity names it.
 */
function balanceRowsOf(body: ApiBody, acct: IYahavAcct): readonly ApiRecord[] {
  const entities = yahavEntities(body);
  const entity = entities.find(candidate => isYahavAccountOf(candidate.AccountId, acct));
  const rows = entity?.BalanceList;
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

/**
 * The account's CURRENT amount as the bank sent it.
 * @param body - Balance answer body.
 * @param acct - The account.
 * @returns The raw amount; undefined when the bank sent none.
 */
function currentAmountOf(body: ApiBody, acct: IYahavAcct): unknown {
  const rows = balanceRowsOf(body, acct);
  const current = rows.find(isCurrentBalType) ?? {};
  return getIn(current, ['CurrAmt', 'Amt', 'Value']);
}

/**
 * Whether an amount is a finite number or decimal text.
 * @param value - Raw amount.
 * @returns True when finite.
 */
function isFiniteAmount(value: unknown): boolean {
  const isText = typeof value === 'string' && DECIMAL.test(value);
  if (!isText && typeof value !== 'number') return false;
  const parsed = Number(value);
  return Number.isFinite(parsed);
}

/**
 * Whether the answer lacks a usable CURRENT figure for the account.
 * @param body - Balance answer body.
 * @param acct - The account.
 * @returns True when absent.
 */
function balanceAbsent(body: ApiBody, acct: IYahavAcct): boolean {
  const amount = currentAmountOf(body, acct);
  return !isFiniteAmount(amount);
}

/**
 * The account's CURRENT figure; read only once it is known present.
 * @param body - Balance answer body.
 * @param acct - The account.
 * @returns The figure.
 */
function balanceExtract(body: ApiBody, acct: IYahavAcct): number {
  const amount = currentAmountOf(body, acct);
  return Number(amount);
}

/** Accounts read: the portfolio's current ILS accounts. */
const YAHAV_CUSTOMER: IApiDirectScrapeCustomerStep<IYahavAcct> = {
  buildVars: accountsVars,
  extractAccounts: extractYahavAccounts,
  countDiscovered: countYahavAccounts,
  urlTag: YAHAV_ACCOUNT_URL,
  method: 'POST',
  extraHeaders: YAHAV_ACCOUNT_HEADERS,
};

/** Balance read: the account's CURRENT figure, absent when unusable. */
const YAHAV_BALANCE: IApiDirectScrapeBalanceStep<IYahavAcct> = {
  buildVars: balanceVars,
  extract: balanceExtract,
  isAbsent: balanceAbsent,
  urlTag: YAHAV_ACCOUNT_URL,
  method: 'POST',
  extraHeaders: YAHAV_ACCOUNT_HEADERS,
};

export { YAHAV_ACCOUNT_HEADERS, YAHAV_ACCOUNT_URL, YAHAV_BALANCE, YAHAV_CUSTOMER };
