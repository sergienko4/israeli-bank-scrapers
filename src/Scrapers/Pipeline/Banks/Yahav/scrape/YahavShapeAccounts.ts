/**
 * Yahav BaNCS scrape shape — customer (accounts) + balance steps. Both POST
 * the multiplexed `/account` endpoint with a BaNCS `MessageEnvelope`; the
 * accounts call resolves the DDA account list (0014) and the balance call
 * reads the `portfolioBalance` CURRENT amount (0023). Auth rides the browser
 * session cookies + the body `SecToken` captured at BIND — no auth header.
 */

import selectBancsBalance from '../../../Mediator/Scrape/Bancs/BancsBalance.js';
import type {
  ApiBody,
  IApiDirectScrapeBalanceStep,
  IApiDirectScrapeCustomerStep,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { extractYahavAccounts } from './YahavAccountExtract.js';
import { buildEnvelope, csrfHeaders } from './YahavShapeEnvelope.js';
import { ACCOUNT_PATH, type IYahavAcct, YAHAV_API } from './YahavShapeHelpers.js';
import { accountsPayload, balancePayload } from './YahavShapePayloads.js';

/**
 * The fixed multiplexed `/account` endpoint URL (accounts + balance + txns).
 * @returns Literal account URL.
 */
function accountUrl(): WKUrlOrLiteral {
  return literalUrl(`${YAHAV_API}${ACCOUNT_PATH}`);
}

/**
 * Accounts request body — the accounts Payload in the BaNCS envelope.
 * @param ctx - Action context.
 * @returns Variables map POSTed as the JSON body.
 */
function accountsVars(ctx: IActionContext): VarsMap {
  const payload = accountsPayload(ctx);
  return buildEnvelope(ctx, payload);
}

/**
 * Balance request body — the portfolioBalance Payload in the envelope.
 * @param _acct - Resolved account (unused; balance is portfolio-level).
 * @param ctx - Action context.
 * @returns Variables map POSTed as the JSON body.
 */
function balanceVars(_acct: IYahavAcct, ctx: IActionContext): VarsMap {
  const payload = balancePayload(ctx);
  return buildEnvelope(ctx, payload);
}

/**
 * CURRENT balance from the portfolioBalance response (0 when absent).
 * @param body - Balance response body.
 * @returns Finite CURRENT balance, or 0.
 */
function balanceExtract(body: ApiBody): number {
  const found = selectBancsBalance(body);
  return found === false ? 0 : found;
}

/** Customer step — POST the accounts Payload, resolve the DDA account list. */
export const YAHAV_CUSTOMER: IApiDirectScrapeCustomerStep<IYahavAcct> = {
  buildVars: accountsVars,
  extractAccounts: extractYahavAccounts,
  urlTag: accountUrl,
  method: 'POST',
  extraHeaders: csrfHeaders,
};

/** Balance step — POST the portfolioBalance Payload, read CURRENT balance. */
export const YAHAV_BALANCE: IApiDirectScrapeBalanceStep<IYahavAcct> = {
  buildVars: balanceVars,
  extract: balanceExtract,
  urlTag: accountUrl,
  method: 'POST',
  fallbackOnFail: 0,
  extraHeaders: csrfHeaders,
};
