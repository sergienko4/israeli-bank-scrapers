/**
 * Hapoalim scrape shape — account list + balance extractors + REST
 * urlTag builders for the ServerServices gateway. Transactions helpers
 * live in HapoalimShapeTxns.ts. Accounts + balance are cookie-authed GET
 * (session cookies ride BrowserFetchStrategy through the live login
 * page); transactions is an anti-replay POST (see HapoalimShapeTxns.ts).
 *
 * Contract grounded in the captured trace
 * (C:\tmp\runs\pipeline\hapoalim\04-07-2026_03183039) and the upstream
 * `hapoalim.ts` recipe: the account id is the composite
 * `bankNumber-branchNumber-accountNumber` (e.g. 12-170-536347); balance
 * reads `currentBalance` from the balanceAndCreditLimit resource. Raw
 * rows normalise downstream via the Data Mapper — never in the shape.
 */

import type {
  ApiBody,
  IExtractAccountsArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';

/** ServerServices gateway origin — Hapoalim's fixed post-login API host. */
export const HAPOALIM_API = 'https://login.bankhapoalim.co.il/ServerServices';

/** Composite account number — branded for Rule #15. */
type AccountNumberDisplay = Brand<string, 'HapoalimAccountNumberDisplay'>;
/** Current account balance — branded for Rule #15. */
type AccountBalance = Brand<number, 'HapoalimAccountBalance'>;

/**
 * Hapoalim account reference. `composite` is the
 * `bankNumber-branchNumber-accountNumber` id used both as the display
 * number and as the `accountId` / `partyCurrentAccount` URL param.
 */
export interface IHapoalimAcct {
  readonly composite: string;
}

interface IHapoalimRawAccount {
  readonly bankNumber?: number;
  readonly branchNumber?: number;
  readonly accountNumber?: string | number;
  readonly accountClosingReasonCode?: number;
}
interface IBalanceResp {
  readonly currentBalance?: number;
  readonly withdrawalBalance?: number;
}

/**
 * Whether an account is open (closing-reason 0). Closed accounts are
 * excluded (upstream parity).
 * @param a - Raw account entry.
 * @returns True when the account is open.
 */
function isOpen(a: IHapoalimRawAccount): boolean {
  return a.accountClosingReasonCode === 0;
}

/**
 * Build the composite id from a raw account row.
 * @param a - Raw account entry.
 * @returns Account reference (composite id).
 */
function toAcct(a: IHapoalimRawAccount): IHapoalimAcct {
  const parts = [a.bankNumber, a.branchNumber, a.accountNumber];
  return { composite: parts.map(String).join('-') };
}

/**
 * Flatten the top-level accounts array into open-account references.
 * @param args - Extract-args bundle (reads args.body only).
 * @returns Open account list (empty when the payload is absent).
 */
export function extractAccounts(args: IExtractAccountsArgs): readonly IHapoalimAcct[] {
  const rows = args.body as unknown as readonly IHapoalimRawAccount[] | undefined;
  return (rows ?? []).filter(isOpen).map(toAcct);
}

/**
 * User-facing account number (the composite id).
 * @param acct - Hapoalim account.
 * @returns Display number.
 */
export function accountNumberOf(acct: IHapoalimAcct): AccountNumberDisplay {
  return acct.composite as AccountNumberDisplay;
}

/**
 * Current balance — `currentBalance`, falling back to withdrawal then 0.
 * @param body - Unwrapped balanceAndCreditLimit response.
 * @returns Current account balance.
 */
export function balanceExtract(body: ApiBody): AccountBalance {
  const resp = body as unknown as IBalanceResp;
  return (resp.currentBalance ?? resp.withdrawalBalance ?? 0) as AccountBalance;
}

/**
 * Customer URL — the static accounts endpoint (no per-call params).
 * @returns Literal ServerServices accounts URL.
 */
export function customerUrl(): WKUrlOrLiteral {
  return literalUrl(`${HAPOALIM_API}/general/accounts?lang=he`);
}

/**
 * Balance URL — current-account/composite/balanceAndCreditLimit.
 * @param acct - Hapoalim account.
 * @returns Literal balance URL for the account.
 */
export function balanceUrl(acct: IHapoalimAcct): WKUrlOrLiteral {
  const path = `${HAPOALIM_API}/current-account/composite/balanceAndCreditLimit`;
  return literalUrl(`${path}?partyCurrentAccount=${acct.composite}&lang=he`);
}

/**
 * No-op variables builder — GET calls carry params in the URL.
 * @returns Empty variables map.
 */
export function noVars(): VarsMap {
  return {};
}
