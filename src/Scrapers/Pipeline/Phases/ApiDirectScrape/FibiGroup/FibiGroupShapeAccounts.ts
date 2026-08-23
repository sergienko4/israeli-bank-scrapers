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

import ScraperError from '../../../../Base/ScraperError.js';
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

/**
 * Rejection messages for unusable identity fields.
 *
 * <p>All three fields identify the account on the wire: `accountType` is a
 * path segment of the balances URL and a transactions body field, `branch`
 * is a transactions body field, and `accountNumber` is `Number()`-coerced
 * into that same body. Defaulting any of them produced a *well-formed*
 * request aimed at a non-existent account, so a degraded identity response
 * surfaced as an empty scrape indistinguishable from a genuinely empty
 * account. Since the FIBI group factory serves four brands, that failure
 * mode is shared. Rejecting turns a silent mis-scrape into a loud stop.
 *
 * <p>Messages name the field only, never its value — see
 * `logging-pii-guidlines.md`.
 */
const NO_ACCOUNT_TYPE = 'FIBI accountType lookup returned no usable type code';
const NO_ACCOUNT_NUMBER = 'FIBI userData row has no wire-usable account number';
const NO_BRANCH = 'FIBI userData row is missing its branch code';

/**
 * Sentinel for "the accountType lookup did not run". Deliberately empty so
 * it fails `typeOf`'s check rather than standing in for a real response.
 */
const EMPTY_SECONDARY: ApiBody = Object.freeze({});

/**
 * Guard for a positive identity code.
 *
 * <p>`0` is rejected on purpose: it is the exact value this module used to
 * invent as a default, so accepting a bank-sent `0` would rebuild the same
 * wrong request the rejection exists to prevent.
 * @param value - Candidate code.
 * @returns True when the value is a positive safe integer.
 */
function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Guard for a string carrying non-whitespace content.
 * @param value - Candidate string.
 * @returns True when the value is a non-blank string.
 */
function isFilledText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Guard for an account number that survives the wire coercion.
 *
 * <p>The transactions body sends `Number(accountNumber)`, and both `''` and
 * a whitespace-only string coerce to `0` while a non-numeric string coerces
 * to `NaN`. A blank-check alone therefore still let a wrong account through,
 * so the coerced value is what gets validated.
 * @param value - Candidate account number.
 * @returns True when the value coerces to a positive integer.
 */
function isWireNumber(value: unknown): value is string {
  if (!isFilledText(value)) return false;
  const numeric = Number(value);
  return isPositiveInt(numeric);
}

/**
 * Session-level account type (`accountType[0].accountType`).
 * @param secondary - accountType-lookup response body.
 * @returns Numeric account type code.
 * @throws ScraperError when the lookup yielded no usable positive code.
 */
function typeOf(secondary: ApiBody): number {
  const resp = secondary as unknown as IAccountTypeResp;
  const code = resp.accountType?.[0]?.accountType;
  if (!isPositiveInt(code)) throw new ScraperError(NO_ACCOUNT_TYPE);
  return code;
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
 *
 * <p>`branch` is rejected when absent rather than defaulted. Every captured
 * FIBI transactions request carries a concrete zero-padded branch (e.g.
 * `"099"`), and no captured `userData` row omits one, so requiring it
 * cannot fail a payload the bank actually sends — while an empty branch
 * would ride along in the transactions body and address the wrong account.
 * The value stays a string so leading zeros survive.
 * @param row - Raw userData account.
 * @param accountType - Session-level numeric type code.
 * @returns FIBI account reference.
 * @throws ScraperError when the row carries no usable account number or branch.
 */
function toAcct(row: IRawAccount, accountType: number): IFibiAcct {
  const { account, branch } = row;
  if (!isWireNumber(account)) throw new ScraperError(NO_ACCOUNT_NUMBER);
  if (!isFilledText(branch)) throw new ScraperError(NO_BRANCH);
  return { accountNumber: account, branch, accountType };
}

/**
 * Merge the userData accounts (primary body) with the session-level
 * accountType (secondaryBody) into flat account references.
 *
 * <p>"No accounts" stays a valid, non-throwing outcome: the account type is
 * only demanded once there is a row to attach it to. That keeps an absent
 * userData payload returning `[]` while a *present* row with unusable
 * identity fields fails loudly.
 * @param args - Extract-args bundle (body + secondaryBody).
 * @returns Account list (empty when userData is absent).
 * @throws ScraperError when a chosen row cannot yield a usable identity.
 */
export function extractAccounts(args: IExtractAccountsArgs): readonly IFibiAcct[] {
  const rows = (args.body as unknown as IUserDataResp).accounts ?? [];
  const chosen = chooseAccounts(rows);
  if (chosen.length === 0) return [];
  const accountType = typeOf(args.secondaryBody ?? EMPTY_SECONDARY);
  return chosen.map((row): IFibiAcct => toAcct(row, accountType));
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
