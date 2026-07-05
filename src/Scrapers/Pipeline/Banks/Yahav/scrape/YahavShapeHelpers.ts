/**
 * Yahav (TCS BaNCS Digital) scrape shape — shared primitives.
 *
 * BaNCS multiplexes accounts, balance and transactions through the SAME
 * `POST https://digital.yahav.co.il/BaNCSDigitalApp/account` endpoint,
 * differentiated only by the request `Payload`. Every request is a large
 * `MessageEnvelope_1.0.0` whose session-specific fields (the auth `SecToken`
 * object and the portfolio `iorId`) are captured at BIND from the login-boot
 * pool; the rest is a fixed template. Grounded in the captured trace
 * (C:\tmp\runs\pipeline\yahav\02-07-2026_17363193).
 */

import type { Brand } from '../../../Types/Brand.js';

/** BaNCS Digital API origin — Yahav's fixed post-login data host. */
export const YAHAV_API = 'https://digital.yahav.co.il';

/** The multiplexed BaNCS data path (accounts + balance + transactions). */
export const ACCOUNT_PATH = '/BaNCSDigitalApp/account';

/** Correlation id for the envelope `MsgId` — branded for Rule #15. */
type MsgId = Brand<string, 'YahavMsgId'>;

/**
 * Yahav account reference resolved from the accounts response. `id` +
 * `iorId` ride the transactions request body; `balance` is read from the
 * same accounts response (`BalanceList[CURRENT]`), so no extra fetch.
 */
export interface IYahavAcct {
  readonly id: string;
  readonly iorId: string;
  readonly balance: number;
}

/**
 * Fresh envelope message id (a monotonic-enough numeric string).
 * @returns MsgId string.
 */
export function msgId(): MsgId {
  const n = Date.now() % 100_000_000;
  return String(n) as MsgId;
}
