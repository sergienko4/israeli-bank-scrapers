/**
 * Otsar Hahayal (FIBI group) scrape shape — shared primitives: the fixed
 * API host, per-request `uid` correlation GUID, the account reference
 * type, the balance extractor + balance urlTag, and the no-op vars
 * builder. Account-identity merge lives in OtsarHahayalShapeAccounts.ts;
 * transactions in OtsarHahayalShapeTxns.ts.
 *
 * Otsar Hahayal is a First-International (FIBI) group brand sharing the
 * identical Mataf/appsng BFF contract with Beinleumi (userData +
 * bff-balancetransactions) — paths are cloned per the
 * zero-cross-bank-import convention and only the API host differs. The
 * host follows the proven FIBI `online.<login-domain>` transform: login
 * www.bankotsar.co.il -> API online.bankotsar.co.il (DNS-confirmed on the
 * shared FIBI subnet; same registrable domain, so the session cookies set
 * at login ride to the API host — the mechanism proven live for Beinleumi
 * www.fibi.co.il -> online.fibi.co.il). Every post-login call is
 * cookie-authed and every GET carries a fresh random `uid`.
 * balanceKind=account. Raw txn rows normalise downstream via the Data
 * Mapper — never in the shape. Host DNS + pattern-grounded; a full
 * live-E2E on real credentials is still pending.
 */

import { randomUUID } from 'node:crypto';

import type { ApiBody, VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';

/** Otsar Hahayal BFF origin — FIBI online.<login-domain> API host. */
export const OTSAR_HAHAYAL_API = 'https://online.bankotsar.co.il';
/** userData path — accounts source (account number + branch). */
export const USER_DATA_PATH = '/MatafAngularRestApiService/rest/utils/userData';
/** BFF base — accountType, balances, and list all hang off this prefix. */
export const BFF_BASE = '/appsng/bff-balancetransactions/api/v1/transactions';

/** Current account balance — branded for Rule #15. */
type AccountBalance = Brand<number, 'OtsarHahayalAccountBalance'>;

/** Correlation GUID for a `uid` query param — branded for Rule #15. */
type Uid = Brand<string, 'OtsarHahayalUid'>;

/**
 * Otsar Hahayal account reference. `accountType` (a session-level numeric
 * code, e.g. 105) rides both the balance URL path segment and the
 * transactions request body.
 */
export interface IOtsarHahayalAcct {
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
 * @param acct - Otsar Hahayal account.
 * @returns Literal balances URL for the account.
 */
export function balanceUrl(acct: IOtsarHahayalAcct): WKUrlOrLiteral {
  const path = `${BFF_BASE}/balances/${String(acct.accountType)}`;
  return literalUrl(`${OTSAR_HAHAYAL_API}${path}?uid=${uid()}`);
}

/**
 * No-op variables builder — GET calls carry params in the URL.
 * @returns Empty variables map.
 */
export function noVars(): VarsMap {
  return {};
}
