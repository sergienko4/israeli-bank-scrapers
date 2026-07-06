/**
 * Mercantile scrape shape — account list + balance extractors + REST
 * urlTag builders for the Titan gateway. Transactions helpers live in
 * MercantileShapeTxns.ts. All three calls are cookie-authed GET (session
 * cookies ride BrowserFetchStrategy through the live login page).
 *
 * Mercantile shares Discount's Titan tenant (start.telebank.co.il): the
 * upstream MercantileScraper extends DiscountScraper and overrides only
 * the loginUrl (`bank=m`), so the post-auth API contract is identical.
 * Cloned (not imported) per the zero-cross-bank-import convention. Raw
 * OperationEntry rows normalise downstream via
 * PIPELINE_WELL_KNOWN_TXN_FIELDS (the Data Mapper) — never in the shape.
 */

import type {
  ApiBody,
  IExtractAccountsArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';

/** Titan gateway origin — Mercantile shares Discount's fixed API host. */
export const TITAN_API = 'https://start.telebank.co.il/Titan/gatewayAPI';

/** Account display number — branded for Rule #15. */
type AccountNumberDisplay = Brand<string, 'MercantileAccountNumberDisplay'>;
/** Current account balance — branded for Rule #15. */
type AccountBalance = Brand<number, 'MercantileAccountBalance'>;

/**
 * Mercantile account reference. `accountId` (NewAccountInfo.AccountID) is
 * the Titan API path id used in balance + transactions URLs;
 * `displayNumber` (FormatAccountID) is the user-facing account number.
 */
export interface IMercantileAcct {
  readonly accountId: string;
  readonly displayNumber: string;
}

interface INewAccountInfo {
  readonly AccountID?: string;
}
interface IUserAccount {
  readonly NewAccountInfo?: INewAccountInfo;
  readonly FormatAccountID?: string;
}
interface ICustomerResp {
  readonly UserAccountsData?: { readonly UserAccounts?: readonly IUserAccount[] };
}
interface IBalanceResp {
  readonly AccountInfoAndBalance?: {
    readonly AccountBalance?: number;
    readonly AccountAvailableBalance?: number;
  };
}

/**
 * Map one raw UserAccount to an account reference.
 * @param a - Raw user-account entry.
 * @returns Account reference (path id + display number).
 */
function toAcct(a: IUserAccount): IMercantileAcct {
  const accountId = a.NewAccountInfo?.AccountID ?? '';
  return { accountId, displayNumber: a.FormatAccountID ?? accountId };
}

/**
 * Flatten UserAccountsData.UserAccounts[] into account references.
 * @param args - Extract-args bundle (reads args.body only).
 * @returns Account list (empty when the container is absent).
 */
export function extractAccounts(args: IExtractAccountsArgs): readonly IMercantileAcct[] {
  const resp = args.body as unknown as ICustomerResp;
  const rows = resp.UserAccountsData?.UserAccounts ?? [];
  return rows.map(toAcct).filter((acct): boolean => acct.accountId.length > 0);
}

/**
 * User-facing account number (FormatAccountID).
 * @param acct - Mercantile account.
 * @returns Display number.
 */
export function accountNumberOf(acct: IMercantileAcct): AccountNumberDisplay {
  return acct.displayNumber as AccountNumberDisplay;
}

/**
 * Current balance — AccountBalance, falling back to available then 0.
 * @param body - Unwrapped infoAndBalance response.
 * @returns Current account balance.
 */
export function balanceExtract(body: ApiBody): AccountBalance {
  const info = (body as unknown as IBalanceResp).AccountInfoAndBalance;
  return (info?.AccountBalance ?? info?.AccountAvailableBalance ?? 0) as AccountBalance;
}

/**
 * Customer URL — the static accounts endpoint (no per-call params).
 * @returns Literal Titan userAccountsData URL.
 */
export function customerUrl(): WKUrlOrLiteral {
  return literalUrl(`${TITAN_API}/userAccountsData?FetchAccountsNickName=true&FirstTimeEntry=true`);
}

/**
 * Balance URL — accountDetails/infoAndBalance/{accountId}.
 * @param acct - Mercantile account.
 * @returns Literal Titan balance URL for the account.
 */
export function balanceUrl(acct: IMercantileAcct): WKUrlOrLiteral {
  return literalUrl(`${TITAN_API}/accountDetails/infoAndBalance/${acct.accountId}`);
}

/**
 * No-op variables builder — Titan GET calls carry params in the URL.
 * @returns Empty variables map.
 */
export function noVars(): VarsMap {
  return {};
}
