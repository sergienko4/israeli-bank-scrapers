/**
 * Beinleumi (FIBI) scrape shape — shared primitives: the fixed API host,
 * per-request `uid` correlation GUID, the account reference type, the
 * balance extractor + balance urlTag, and the no-op vars builder.
 * Account-identity merge lives in BeinleumiShapeAccounts.ts; transactions
 * in BeinleumiShapeTxns.ts.
 *
 * Every post-login call is cookie-authed (session cookies ride the live
 * login page through BrowserFetchStrategy) and every GET carries a fresh
 * random `uid`. balanceKind=account: balance reads `currentBalance` from
 * `balances/<accountType>`. Raw txn rows normalise downstream via the
 * Data Mapper — never in the shape.
 *
 * Contract grounded in the captured trace
 * (C:\tmp\runs\pipeline\beinleumi\04-07-2026_11221970).
 */

import { randomUUID } from 'node:crypto';

import type { ApiBody, VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';

/** FIBI BFF origin — Beinleumi's fixed post-login API host. */
export const BEINLEUMI_API = 'https://online.fibi.co.il';
/** userData path — accounts source (account number + branch). */
export const USER_DATA_PATH = '/MatafAngularRestApiService/rest/utils/userData';
/** BFF base — accountType, balances, and list all hang off this prefix. */
export const BFF_BASE = '/appsng/bff-balancetransactions/api/v1/transactions';

/** Current account balance — branded for Rule #15. */
type AccountBalance = Brand<number, 'BeinleumiAccountBalance'>;

/** Correlation GUID for a `uid` query param — branded for Rule #15. */
type Uid = Brand<string, 'BeinleumiUid'>;

/**
 * Beinleumi account reference. `accountType` (a session-level numeric
 * code, e.g. 105) rides both the balance URL path segment and the
 * transactions request body.
 */
export interface IBeinleumiAcct {
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
 * @param acct - Beinleumi account.
 * @returns Literal balances URL for the account.
 */
export function balanceUrl(acct: IBeinleumiAcct): WKUrlOrLiteral {
  const path = `${BFF_BASE}/balances/${String(acct.accountType)}`;
  return literalUrl(`${BEINLEUMI_API}${path}?uid=${uid()}`);
}

/**
 * No-op variables builder — GET calls carry params in the URL.
 * @returns Empty variables map.
 */
export function noVars(): VarsMap {
  return {};
}
