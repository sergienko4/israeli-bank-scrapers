/**
 * Mizrahi scrape shape — balance step, which is also the account switch.
 *
 * <p>`SkyBL/changeAccount` is the call the SPA makes when the user picks an
 * account: `{ selectedAccountIndex }` is the account's position in the logon
 * `Accounts[]`, and the session's later `get428Index` calls serve that
 * account (real login #12). Its reply carries the account's
 * `SnifAndNumber400` and its current balance `YitraAdkanit`, so one call both
 * switches and prices the account (plan D17). The driver runs the balance
 * step before the transactions step of the same account, so every
 * `get428Index` runs on the account just switched to.
 *
 * <p>An index the bank does not know still answers 200, and leaves the
 * session unusable, so the reply's `SnifAndNumber400` must name the account:
 * a reply naming another account, or none, fails the scrape. The switch is
 * the only proof the session serves this account (a transactions page names
 * its owner only when the range reaches today), so an unconfirmed switch is
 * never trusted. A failed call has no `fallbackOnFail`, so it discards the
 * scrape rather than read movements of the wrong account. Outside banking
 * hours the bank sends `YitraAdkanit: null`, which is reported absent; the
 * night reply was never observed, so if it omits the account a night scrape
 * fails loudly (the night window serves no rows anyway, plan R15).
 */

import ScraperError from '../../../../Base/ScraperError.js';
import type { ApiBody, VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl, type WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { Brand } from '../../../Types/Brand.js';
import { type IMizrahiAcct, MIZRAHI_API } from './MizrahiShapeHelpers.js';

/** Raised when the switch did not confirm landing on the account asked for. */
const FOREIGN_SWITCH = 'Mizrahi changeAccount did not land on the requested account';

/** Current account balance — branded for Rule #15. */
type AccountBalance = Brand<number, 'MizrahiAccountBalance'>;
/** Whether a balance figure is missing — branded for Rule #15. */
type IsBalanceAbsent = Brand<boolean, 'MizrahiIsBalanceAbsent'>;

/** The `SkyBL/changeAccount` response subset the shape reads. */
interface IChangeAccountResp {
  readonly body?: {
    readonly SnifAndNumber400?: string;
    readonly YitraAdkanit?: number | null;
  };
}

/**
 * Balance-step URL — the account switch.
 * @returns Literal changeAccount URL.
 */
export function balanceUrl(): WKUrlOrLiteral {
  return literalUrl(`${MIZRAHI_API}/SkyBL/changeAccount`);
}

/**
 * Balance-step vars — select the account by its logon position.
 * @param acct - Mizrahi account.
 * @returns changeAccount request body.
 */
export function balanceVars(acct: IMizrahiAcct): VarsMap {
  return { selectedAccountIndex: acct.index };
}

/**
 * Whether the switched account's balance is unknown — `YitraAdkanit` is not
 * a number (night).
 * @param body - changeAccount response body.
 * @param acct - Mizrahi account.
 * @returns True when the balance is unknown.
 * @throws ScraperError when the reply does not name this account.
 */
export function balanceIsAbsent(body: ApiBody, acct: IMizrahiAcct): IsBalanceAbsent {
  const reply = (body as IChangeAccountResp).body;
  if (reply?.SnifAndNumber400 !== acct.accountNumber) throw new ScraperError(FOREIGN_SWITCH);
  return !Number.isFinite(reply.YitraAdkanit) as IsBalanceAbsent;
}

/**
 * Balance extractor — the switched account's `YitraAdkanit`. The `?? 0` is
 * unreachable in the driver, which consults {@link balanceIsAbsent} first.
 * @param body - changeAccount response body.
 * @returns Current balance.
 */
export function balanceExtract(body: ApiBody): AccountBalance {
  return ((body as IChangeAccountResp).body?.YitraAdkanit ?? 0) as AccountBalance;
}
