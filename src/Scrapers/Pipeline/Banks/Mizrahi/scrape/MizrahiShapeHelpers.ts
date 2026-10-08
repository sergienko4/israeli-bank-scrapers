/**
 * Mizrahi scrape shape — account list helpers.
 *
 * <p>The accounts ride `SkyBL/logon` (`body.user.Accounts[]`), the session
 * handshake the SPA fires right after LoginUser. Its request carries only
 * static app metadata, and re-posting it is idempotent: real login #10 got
 * 200 with the SAME `xsrfToken`, and the discovered-header bag kept working
 * for `get428Index` and `Get428ODS` afterwards.
 *
 * <p>Every declared account is scraped. `get428Index` serves the session's
 * CURRENT account only, so each account carries its POSITION in
 * `Accounts[]` — the `selectedAccountIndex` the SPA's `SkyBL/changeAccount`
 * switch takes (MizrahiShapeBalance, plan D17).
 */

import ScraperError from '../../../../Base/ScraperError.js';
import type {
  IExtractAccountsArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';

/** Post-login API origin (every hard-model call targets it). */
export const MIZRAHI_API = 'https://mto.mizrahi-tefahot.co.il/Online/api';

/** Static logon body the SPA sends (trace-3 and real logins #6–#10). */
const LOGON_VARS: VarsMap = { appId: 'skyWeb', appVer: '', lang: 'he-il', isPdf: false };

/** Raised when a declared account carries no number to scrape it by. */
const NO_ACCOUNT_NUMBER = 'Mizrahi logon account has no SnifAndNumber400';

/** Account display number — branded for Rule #15. */
type AccountNumberDisplay = Brand<string, 'MizrahiAccountNumberDisplay'>;

/** One raw `body.user.Accounts[]` entry (only the field the shape reads). */
interface IRawAccount {
  readonly SnifAndNumber400?: string;
}

/** The `SkyBL/logon` response subset the shape reads. */
interface ILogonResp {
  readonly body?: { readonly user?: { readonly Accounts?: readonly IRawAccount[] } };
}

/**
 * Mizrahi account reference — `index` is the account's position in the
 * logon `Accounts[]` (the `changeAccount` selector) and `accountNumber` its
 * `SnifAndNumber400`.
 */
export interface IMizrahiAcct {
  readonly index: number;
  readonly accountNumber: string;
}

/**
 * Customer-step URL — the logon handshake that lists the accounts.
 * @returns Literal logon URL.
 */
export function customerUrl(): WKUrlOrLiteral {
  return literalUrl(`${MIZRAHI_API}/SkyBL/logon`);
}

/**
 * Customer-step vars — the static logon body.
 * @returns Logon body.
 */
export function customerVars(): VarsMap {
  return LOGON_VARS;
}

/**
 * Map one raw account to the shape's reference.
 * @param raw - Raw logon account.
 * @param index - Its position in `Accounts[]`.
 * @returns Account reference.
 * @throws ScraperError when the account carries no number.
 */
function toAcct(raw: IRawAccount, index: number): IMizrahiAcct {
  const accountNumber = raw.SnifAndNumber400;
  if (typeof accountNumber !== 'string' || accountNumber === '') {
    throw new ScraperError(NO_ACCOUNT_NUMBER);
  }
  return { index, accountNumber };
}

/**
 * Every account the logon payload declared, with its position.
 * @param args - Extract-args bundle (uses `args.body` only).
 * @returns Account references, in payload order.
 */
export function extractAccounts(args: IExtractAccountsArgs): readonly IMizrahiAcct[] {
  const raw = (args.body as ILogonResp).body?.user?.Accounts ?? [];
  return raw.map(toAcct);
}

/**
 * Display account number (`SnifAndNumber400`, branch-account).
 * @param acct - Mizrahi account.
 * @returns Display number.
 */
export function accountNumberOf(acct: IMizrahiAcct): AccountNumberDisplay {
  return acct.accountNumber as AccountNumberDisplay;
}
