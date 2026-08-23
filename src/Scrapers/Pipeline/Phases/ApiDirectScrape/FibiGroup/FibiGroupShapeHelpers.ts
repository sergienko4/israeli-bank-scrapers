/**
 * FIBI group scrape shape — neutral family primitives shared by every
 * First-International brand (Beinleumi, Massad, OtsarHahayal, Pagi).
 *
 * All four brands speak the same Mataf/appsng contract and differ only by
 * their post-login origin: `userData` for account identity, and a
 * `bff-balancetransactions` prefix carrying accountType, balances and list.
 * Each brand keeps its own origin because BrowserFetchStrategy dispatches
 * through the live login page — the BFF must be same-origin or the session
 * cookies will not ride.
 *
 * This module owns the origin-independent half. Brand modules bind it to
 * one origin via the `make*` builders, which keeps the family's behaviour
 * in one place while preserving the zero-cross-bank-import convention: a
 * brand imports this neutral module, never a sibling brand.
 */

import { randomUUID } from 'node:crypto';

import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';
import type { ApiBody, VarsMap } from '../IApiDirectScrapeShape.js';

/** userData path — accounts source (account number + branch). */
export const USER_DATA_PATH = '/MatafAngularRestApiService/rest/utils/userData';
/** BFF base — accountType, balances, and list all hang off this prefix. */
export const BFF_BASE = '/appsng/bff-balancetransactions/api/v1/transactions';

/** Current account balance — branded for Rule #15. */
export type FibiAccountBalance = Brand<number, 'FibiAccountBalance'>;

/** Correlation GUID for a `uid` query param — branded for Rule #15. */
export type FibiUid = Brand<string, 'FibiUid'>;

/**
 * One brand's binding of the shared FIBI contract. `apiOrigin` is the only
 * axis on which the four brands differ.
 */
export interface IFibiGroupConfig {
  readonly apiOrigin: string;
}

/**
 * FIBI account reference. `accountType` (a session-level numeric code,
 * e.g. 105) rides both the balance URL path segment and the transactions
 * request body.
 */
export interface IFibiAcct {
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
export function uid(): FibiUid {
  return randomUUID() as FibiUid;
}

/**
 * Current balance — `currentBalance`, falling back to withdrawable then 0.
 * @param body - Unwrapped balances response.
 * @returns Current account balance.
 */
export function balanceExtract(body: ApiBody): FibiAccountBalance {
  const resp = body as unknown as IBalanceResp;
  return (resp.currentBalance ?? resp.withdrawableBalance ?? 0) as FibiAccountBalance;
}

/**
 * No-op variables builder — GET calls carry params in the URL.
 * @returns Empty variables map.
 */
export function noVars(): VarsMap {
  return {};
}

/**
 * Build a brand's balance URL — balances/<accountType> on that brand's
 * origin, with a fresh uid per call.
 * @param cfg - Brand binding supplying the post-login origin.
 * @param acct - FIBI account.
 * @returns Literal balances URL for the account.
 */
export function balanceUrl(cfg: IFibiGroupConfig, acct: IFibiAcct): WKUrlOrLiteral {
  const path = `${BFF_BASE}/balances/${String(acct.accountType)}`;
  return literalUrl(`${cfg.apiOrigin}${path}?uid=${uid()}`);
}
