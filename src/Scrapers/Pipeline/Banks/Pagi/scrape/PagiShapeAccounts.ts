/**
 * Pagi (FIBI group) scrape shape — account-identity merge across the two
 * cookie-authed identity GETs, plus their urlTag builders. `userData`
 * (customer step) yields the account number + branch; a session-level
 * `accountType` lookup (customer.secondaryUrlTag) yields the numeric type
 * (105 for a retail checking account) the balance path segment and the
 * transactions body both require. The driver folds the second GET in as
 * `secondaryBody`.
 *
 * Single-selected-account scope: FIBI's accountType endpoint is
 * session-level (no account param), so the primary account is the
 * `selected` userData entry — falling back to the whole list only when the
 * payload marks none. Contract shared with Beinleumi (same FIBI Mataf
 * portal); cloned per the zero-cross-bank-import convention. Grounded in
 * the captured trace (C:\tmp\runs\pipeline\beinleumi\04-07-2026_11221970).
 */

import type {
  ApiBody,
  IExtractAccountsArgs,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';
import { BFF_BASE, type IPagiAcct, PAGI_API, uid, USER_DATA_PATH } from './PagiShapeHelpers.js';

/** Display account number — branded for Rule #15. */
type AccountNumberDisplay = Brand<string, 'PagiAccountNumberDisplay'>;

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
 * @returns Pagi account reference.
 */
function toAcct(row: IRawAccount, accountType: number): IPagiAcct {
  return { accountNumber: row.account ?? '', branch: row.branch ?? '', accountType };
}

/**
 * Merge the userData accounts (primary body) with the session-level
 * accountType (secondaryBody) into flat account references.
 * @param args - Extract-args bundle (body + secondaryBody).
 * @returns Account list (empty when userData is absent).
 */
export function extractAccounts(args: IExtractAccountsArgs): readonly IPagiAcct[] {
  const rows = (args.body as unknown as IUserDataResp).accounts ?? [];
  const accountType = typeOf(args.secondaryBody ?? EMPTY_SECONDARY);
  return chooseAccounts(rows).map((row): IPagiAcct => toAcct(row, accountType));
}

/**
 * User-facing account number.
 * @param acct - Pagi account.
 * @returns Display number.
 */
export function accountNumberOf(acct: IPagiAcct): AccountNumberDisplay {
  return acct.accountNumber as AccountNumberDisplay;
}

/**
 * Customer URL — the userData accounts endpoint (fresh uid).
 * @returns Literal userData URL.
 */
export function customerUrl(): WKUrlOrLiteral {
  return literalUrl(`${PAGI_API}${USER_DATA_PATH}?uid=${uid()}`);
}

/**
 * Secondary identity URL — the session-level accountType lookup (fresh uid).
 * @returns Literal accountType URL.
 */
export function secondaryUrl(): WKUrlOrLiteral {
  return literalUrl(`${PAGI_API}${BFF_BASE}/accountType?uid=${uid()}`);
}
