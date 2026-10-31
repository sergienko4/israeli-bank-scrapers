/**
 * Mizrahi scrape shape — account list and per-call header helpers.
 *
 * <p>The accounts ride the login's `SkyBL/logon` reply
 * (`body.user.Accounts[]`), which the login carries into the session context
 * as `accounts`, so the customer step makes no call of its own.
 *
 * <p>Every declared account is scraped. `get428Index` serves the session's
 * CURRENT account only, so each account carries its POSITION in
 * `Accounts[]` — the `selectedAccountIndex` the `SkyBL/changeAccount`
 * switch takes (MizrahiShapeBalance, plan D17).
 *
 * <p>Every data call sends the online-banking POST headers and
 * `mizrahixsrftoken`, the data token the login composed (`mizrahiXsrf`).
 * Login's static and step headers do not reach the scrape phase, so the
 * shape rebuilds them from the shared constants.
 */

import ScraperError from '../../../../Base/ScraperError.js';
import type {
  HeaderMap,
  IExtractAccountsArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  MIZRAHI_MTO,
  MIZRAHI_MTO_POST_HEADERS,
  MIZRAHI_STATIC_HEADERS,
} from '../../../Registry/Config/PipelineBankConfigMizrahiConstants.js';
import type { Brand } from '../../../Types/Brand.js';
import { isSome } from '../../../Types/Option.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';

/** Post-login API origin (every hard-model call targets it). */
export const MIZRAHI_API = `${MIZRAHI_MTO}/Online/api`;

/** Raised when a declared account carries no number to scrape it by. */
const NO_ACCOUNT_NUMBER = 'Mizrahi logon account has no SnifAndNumber400';

/** Account display number — branded for Rule #15. */
type AccountNumberDisplay = Brand<string, 'MizrahiAccountNumberDisplay'>;

/** One raw `body.user.Accounts[]` entry (only the field the shape reads). */
interface IRawAccount {
  readonly SnifAndNumber400?: string;
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
 * The data token the login composed, or an empty value before login has
 * stored one.
 * @param ctx - Action context carrying the API mediator.
 * @returns The data token, or an empty string.
 */
function dataTokenOf(ctx: IActionContext): string {
  if (!isSome(ctx.apiMediator)) return '';
  const session = ctx.apiMediator.value.getSessionContext();
  const token = session.mizrahiXsrf;
  return typeof token === 'string' ? token : '';
}

/**
 * Headers for one data call: the static set, the online-banking POST set and
 * the data token.
 * @param ctx - Action context.
 * @returns Header map.
 */
export function mizrahiHeaders(ctx: IActionContext): HeaderMap {
  const mizrahixsrftoken = dataTokenOf(ctx);
  return { ...MIZRAHI_STATIC_HEADERS, ...MIZRAHI_MTO_POST_HEADERS, mizrahixsrftoken };
}

/**
 * Customer-step vars — none; the customer step makes no call.
 * @returns Empty variables map.
 */
export function noVars(): VarsMap {
  return {};
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
 * Every account the login's logon reply declared, with its position.
 * @param args - Extract-args bundle (uses `args.sessionContext` only).
 * @returns Account references, in payload order.
 */
export function extractAccounts(args: IExtractAccountsArgs): readonly IMizrahiAcct[] {
  const raw = args.sessionContext.accounts;
  if (!Array.isArray(raw)) return [];
  const accounts = raw as readonly IRawAccount[];
  return accounts.map((account, index): IMizrahiAcct => toAcct(account, index));
}

/**
 * Display account number (`SnifAndNumber400`, branch-account).
 * @param acct - Mizrahi account.
 * @returns Display number.
 */
export function accountNumberOf(acct: IMizrahiAcct): AccountNumberDisplay {
  return acct.accountNumber as AccountNumberDisplay;
}
