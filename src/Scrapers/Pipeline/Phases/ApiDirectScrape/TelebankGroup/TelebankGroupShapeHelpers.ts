/**
 * Telebank group scrape shape — account list + balance extractors, REST urlTag
 * builders and the per-call headers for the Titan gateway. Transactions
 * helpers live in TelebankGroupShapeTxns.ts. All three calls are cookie-authed
 * GET: the node transport sends the login's cookie jar, and
 * {@link titanHeaders} echoes the routing cookies as headers.
 */

import {
  TELEBANK_ORIGIN,
  TELEBANK_STATIC_HEADERS,
  TELEBANK_TITAN_HEADERS,
} from '../../../Registry/Config/PipelineBankConfigTelebankFamilyConstants.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import type {
  ApiBody,
  HeaderMap,
  IExtractAccountsArgs,
  IScrapeCallInfo,
  VarsMap,
} from '../IApiDirectScrapeShape.js';

/** Titan gateway — the Telebank family's data API, on the login origin. */
export const TITAN_API = `${TELEBANK_ORIGIN}/Titan/gatewayAPI`;

/** Account display number — branded for Rule #15. */
type AccountNumberDisplay = Brand<string, 'TelebankAccountNumberDisplay'>;
/** Titan account path id — branded for Rule #15. */
type TitanAccountId = Brand<string, 'TelebankTitanAccountId'>;
/** Current account balance — branded for Rule #15. */
type AccountBalance = Brand<number, 'TelebankAccountBalance'>;

/**
 * Telebank account reference. `accountId` (NewAccountInfo.AccountID) is
 * the Titan API path id used in balance + transactions URLs;
 * `displayNumber` (FormatAccountID) is the user-facing account number.
 */
export interface ITelebankAcct {
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
function toAcct(a: IUserAccount): ITelebankAcct {
  const accountId = a.NewAccountInfo?.AccountID ?? '';
  return { accountId, displayNumber: a.FormatAccountID ?? accountId };
}

/**
 * Flatten UserAccountsData.UserAccounts[] into account references.
 * @param args - Extract-args bundle (reads args.body only).
 * @returns Account list (empty when the container is absent).
 */
export function extractAccounts(args: IExtractAccountsArgs): readonly ITelebankAcct[] {
  const resp = args.body as unknown as ICustomerResp;
  const rows = resp.UserAccountsData?.UserAccounts ?? [];
  return rows.map(toAcct).filter((acct): boolean => acct.accountId.length > 0);
}

/**
 * User-facing account number (FormatAccountID).
 * @param acct - Telebank account.
 * @returns Display number.
 */
export function accountNumberOf(acct: ITelebankAcct): AccountNumberDisplay {
  return acct.displayNumber as AccountNumberDisplay;
}

/**
 * The id the Titan API names an account by — the `accountnumber` header of
 * its balance and transactions reads.
 * @param acct - Telebank account.
 * @returns Titan path id.
 */
export function callAccountIdOf(acct: ITelebankAcct): TitanAccountId {
  return acct.accountId as TitanAccountId;
}

/**
 * Headers every Titan call sends (spec §11.2): the routing headers, the
 * retail-app accept and referer, and the call's account id — empty on the
 * accounts read, which belongs to no account.
 * @param _ctx - Action context (unused).
 * @param call - The call the headers are for.
 * @returns Titan header map.
 */
export function titanHeaders(_ctx: IActionContext, call: IScrapeCallInfo): HeaderMap {
  const accountnumber = call.accountId ?? '';
  return { ...TELEBANK_STATIC_HEADERS, ...TELEBANK_TITAN_HEADERS, accountnumber };
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
 * @param acct - Telebank account.
 * @returns Literal Titan balance URL for the account.
 */
export function balanceUrl(acct: ITelebankAcct): WKUrlOrLiteral {
  return literalUrl(`${TITAN_API}/accountDetails/infoAndBalance/${acct.accountId}`);
}

/**
 * No-op variables builder — Titan GET calls carry params in the URL.
 * @returns Empty variables map.
 */
export function noVars(): VarsMap {
  return {};
}
