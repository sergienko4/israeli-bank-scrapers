/**
 * Massad (FIBI group) scrape shape — shared primitives: the fixed API
 * host, per-request `uid` correlation GUID, the account reference type,
 * the balance extractor + balance urlTag, and the no-op vars builder.
 * Account-identity merge lives in MassadShapeAccounts.ts; transactions in
 * MassadShapeTxns.ts.
 *
 * Massad is a First-International (FIBI) group brand. The BFF path shape
 * (userData + bff-balancetransactions) is cloned from Beinleumi per the
 * zero-cross-bank-import convention, but the host is Massad's own
 * post-login origin (online.bankmassad.co.il, from the fork login
 * navigation and upstream MassadScraper BASE_URL) — NOT Beinleumi's
 * online.fibi.co.il. BrowserFetchStrategy dispatches through the live
 * login page, so the BFF must be same-origin or session cookies will not
 * ride. Every post-login call is cookie-authed and every GET carries a
 * fresh random `uid`. balanceKind=account. Raw txn rows normalise
 * downstream via the Data Mapper — never in the shape. Host regrounded
 * from the fork login origin; the cloned BFF paths on this host are
 * pending maintainer live-E2E.
 */

import { randomUUID } from 'node:crypto';

import type { ApiBody, VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';

/** Massad BFF origin — post-login API host (same-origin as login). */
export const MASSAD_API = 'https://online.bankmassad.co.il';
/** userData path — accounts source (account number + branch). */
export const USER_DATA_PATH = '/MatafAngularRestApiService/rest/utils/userData';
/** BFF base — accountType, balances, and list all hang off this prefix. */
export const BFF_BASE = '/appsng/bff-balancetransactions/api/v1/transactions';

/** Current account balance — branded for Rule #15. */
type AccountBalance = Brand<number, 'MassadAccountBalance'>;

/** Correlation GUID for a `uid` query param — branded for Rule #15. */
type Uid = Brand<string, 'MassadUid'>;

/**
 * Massad account reference. `accountType` (a session-level numeric code,
 * e.g. 105) rides both the balance URL path segment and the transactions
 * request body.
 */
export interface IMassadAcct {
  readonly accountNumber: string;
  readonly branch: string;
  readonly accountType: number;
}

interface IBalanceResp {
  readonly currentBalance?: number;
  readonly withdrawableBalance?: number;
}

/**
 * Fresh per-request correlation GUID for a `uid` query param.
 * @returns Random UUID string.
 */
export function uid(): Uid {
  return randomUUID() as Uid;
}

/**
 * Current balance — `currentBalance`, falling back to withdrawable then 0.
 * @param body - Unwrapped balances response.
 * @returns Current account balance.
 */
export function balanceExtract(body: ApiBody): AccountBalance {
  const resp = body as unknown as IBalanceResp;
  return (resp.currentBalance ?? resp.withdrawableBalance ?? 0) as AccountBalance;
}

/**
 * Balance URL — balances/<accountType> (path segment = numeric type).
 * @param acct - Massad account.
 * @returns Literal balances URL for the account.
 */
export function balanceUrl(acct: IMassadAcct): WKUrlOrLiteral {
  const path = `${BFF_BASE}/balances/${String(acct.accountType)}`;
  return literalUrl(`${MASSAD_API}${path}?uid=${uid()}`);
}

/**
 * No-op variables builder — GET calls carry params in the URL.
 * @returns Empty variables map.
 */
export function noVars(): VarsMap {
  return {};
}
