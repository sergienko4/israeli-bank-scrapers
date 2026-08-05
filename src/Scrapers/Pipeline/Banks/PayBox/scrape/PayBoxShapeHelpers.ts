/**
 * PayBox scrape shape — customer + balance extractors.
 *
 * PayBox has no `/getAccounts` endpoint — the login response carries
 * everything we need (`uId` deposited into the carry by /loginBySms).
 * The customer step is therefore `skipFetch: true`; `extractAccounts`
 * synthesises two TAcct entries (wallet + debit) directly from the
 * post-login session-context.
 *
 * The balance for both accounts comes from the same `/sync` endpoint.
 * `/sync` is post-login, so — like every other post-login PayBox call —
 * its body MUST carry the class-y `auth: { … }` envelope (built by
 * PayBoxAuthEnvelope.ts); a body without it is answered with HTTP 400.
 * Pagination state for transactions lives in PayBoxShapeTxns.ts (per
 * the 150-LOC ceiling).
 */

import type {
  ApiBody,
  IExtractAccountsArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { Brand } from '../../../Types/Brand.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { buildAuthEnvelope } from './PayBoxAuthEnvelope.js';

/** Account display number — branded for Rule #15. */
type AccountNumberDisplay = Brand<string, 'PayBoxAccountNumberDisplay'>;
/** Current account balance (ILS, signed) — branded for Rule #15. */
type AccountBalance = Brand<number, 'PayBoxAccountBalance'>;

/**
 * Wallet account ref — PayBox's primary account that backs P2P, interest,
 * incoming transfers, and outgoing transfers. The virtual debit card is
 * intentionally out of scope; the wallet covers the consumer-meaningful
 * activity.
 */
export interface IPayBoxAcct {
  readonly accountNumber: string;
}

interface IBalResp {
  readonly content?: { readonly userFunds?: { readonly balance?: number } };
}

/**
 * Synthesise the single wallet account from the login session-context.
 *
 * PayBox login deposits `uId` (24-hex customer id) into carry; the
 * ApiDirectCall ACTION handler propagates the carry snapshot into the
 * `ApiMediator` session context. We surface ONE account keyed off the
 * uId. When the session-context lacks `uId` we surface zero accounts
 * so the phase's downstream summary clearly signals the bootstrap missed.
 * @param args - Extract-args bundle (uses `args.sessionContext.uId`).
 * @returns One wallet account or an empty list.
 */
export function extractAccountsFromSessionContext(
  args: IExtractAccountsArgs,
): readonly IPayBoxAcct[] {
  const uId = args.sessionContext.uId;
  if (typeof uId !== 'string' || uId.length === 0) return [];
  return [{ accountNumber: uId }];
}

/**
 * Surface the masked uId-style display number for the account.
 * @param acct - PayBox account variant.
 * @returns Display number string.
 */
export function accountNumberOf(acct: IPayBoxAcct): AccountNumberDisplay {
  return acct.accountNumber as AccountNumberDisplay;
}

/**
 * Customer vars builder — customer step skips the network call so
 * this is only consulted when a future caller flips `skipFetch` off.
 * @returns Empty variables map.
 */
export function customerVars(): VarsMap {
  return {};
}

/**
 * Balance vars builder — `/sync` is a post-login call, so its body is
 * the class-y `auth: { … }` envelope. The step declares no
 * `bodyTemplate`, which makes these vars the literal wire body; the
 * AES signer then writes `/auth/signature`.
 *
 * Returning `{}` here (as this builder did until 2026-08) produced the
 * body `{"auth":{"signature":"…"}}` — signed, but carrying no `uId`,
 * `access_token` or device `uuid` — which PayBox rejects with HTTP 400.
 * `fallbackOnFail: 0` masked that rejection as a zero balance.
 * @param _acct - PayBox account (unused — `/sync` is per-session).
 * @param ctx - Action context (source of session-context + creds).
 * @returns Body bundle carrying the auth envelope.
 */
export function balanceVars(_acct: IPayBoxAcct, ctx: IActionContext): VarsMap {
  return { auth: buildAuthEnvelope(ctx) };
}

/**
 * Balance extractor — pulls `content.userFunds.balance` from /sync.
 * Falls back to 0 when the response is missing the balance entirely
 * (PayBox sometimes returns the structure with a null balance during
 * KYC ramp-up).
 * @param body - Unwrapped /sync response.
 * @returns Current balance (ILS).
 */
export function balanceExtract(body: ApiBody): AccountBalance {
  const resp = body as IBalResp;
  return (resp.content?.userFunds?.balance ?? 0) as AccountBalance;
}
