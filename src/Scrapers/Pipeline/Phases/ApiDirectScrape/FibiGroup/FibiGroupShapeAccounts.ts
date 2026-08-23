/**
 * FIBI group scrape shape — account-identity merge across the two
 * cookie-authed identity GETs, plus their urlTag builders.
 *
 * `userData` (customer step) yields the account number + branch; a
 * session-level `accountType` lookup (customer.secondaryUrlTag) yields the
 * numeric type (105 for a retail checking account) that the balance path
 * segment and the transactions body both require. The driver folds the
 * second GET in as `secondaryBody`.
 *
 * Single-selected-account scope: FIBI's accountType endpoint is
 * session-level (no account param), so the primary account is the
 * `selected` userData entry — falling back to the whole list only when the
 * payload marks none.
 *
 * Origin-independent: brand modules bind the urlTag builders to one origin.
 */

import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';
import type { ApiBody, IExtractAccountsArgs } from '../IApiDirectScrapeShape.js';
import {
  BFF_BASE,
  type IFibiAcct,
  type IFibiGroupConfig,
  uid,
  USER_DATA_PATH,
} from './FibiGroupShapeHelpers.js';

/** Display account number — branded for Rule #15. */
export type FibiAccountNumberDisplay = Brand<string, 'FibiAccountNumberDisplay'>;

interface IRawAccount {
  readonly account?: string;
  readonly branch?: string;
  readonly selected?: boolean;
}
interface IUserDataResp {
  readonly accounts?: readonly IRawAccount[];
}
interface IRawAccountType {
  readonly accountType?: number;
}
interface IAccountTypeResp {
  readonly accountType?: readonly IRawAccountType[];
}

/** Empty secondary body — used when no accountType lookup ran. */
const EMPTY_SECONDARY: ApiBody = Object.freeze({});

/**
 * Session-level account type (`accountType[0].accountType`), default 0.
 * @param secondary - accountType-lookup response body.
 * @returns Numeric account type code.
 */
function typeOf(secondary: ApiBody): number {
  const resp = secondary as unknown as IAccountTypeResp;
  return resp.accountType?.[0]?.accountType ?? 0;
}

/**
 * Choose the accounts to scrape — the `selected` entries, or the whole
 * list when the payload marks none (single-account retail fallback).
 * @param rows - Raw userData accounts.
 * @returns Chosen raw accounts.
 */
function chooseAccounts(rows: readonly IRawAccount[]): readonly IRawAccount[] {
  const selected = rows.filter((r): boolean => r.selected === true);
  return selected.length > 0 ? selected : rows;
}

/**
 * Build one account reference from a raw row + session account type.
 * @param row - Raw userData account.
 * @param accountType - Session-level numeric type code.
 * @returns FIBI account reference.
 */
function toAcct(row: IRawAccount, accountType: number): IFibiAcct {
  return { accountNumber: row.account ?? '', branch: row.branch ?? '', accountType };
}

/**
 * Merge the userData accounts (primary body) with the session-level
 * accountType (secondaryBody) into flat account references.
 * @param args - Extract-args bundle (body + secondaryBody).
 * @returns Account list (empty when userData is absent).
 */
export function extractAccounts(args: IExtractAccountsArgs): readonly IFibiAcct[] {
  const rows = (args.body as unknown as IUserDataResp).accounts ?? [];
  const accountType = typeOf(args.secondaryBody ?? EMPTY_SECONDARY);
  return chooseAccounts(rows).map((row): IFibiAcct => toAcct(row, accountType));
}

/**
 * User-facing account number.
 * @param acct - FIBI account.
 * @returns Display number.
 */
export function accountNumberOf(acct: IFibiAcct): FibiAccountNumberDisplay {
  return acct.accountNumber as FibiAccountNumberDisplay;
}

/**
 * Build a brand's customer URL — the userData accounts endpoint on that
 * brand's origin, with a fresh uid per call.
 * @param cfg - Brand binding supplying the post-login origin.
 * @returns Literal userData URL.
 */
export function customerUrl(cfg: IFibiGroupConfig): WKUrlOrLiteral {
  return literalUrl(`${cfg.apiOrigin}${USER_DATA_PATH}?uid=${uid()}`);
}

/**
 * Build a brand's secondary identity URL — the session-level accountType
 * lookup on that brand's origin, with a fresh uid per call.
 * @param cfg - Brand binding supplying the post-login origin.
 * @returns Literal accountType-lookup URL.
 */
export function secondaryUrl(cfg: IFibiGroupConfig): WKUrlOrLiteral {
  return literalUrl(`${cfg.apiOrigin}${BFF_BASE}/accountType?uid=${uid()}`);
}
