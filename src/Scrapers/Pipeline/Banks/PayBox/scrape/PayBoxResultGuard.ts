/**
 * PayBox fail-closed scrape guard — pure data + predicate consumed by
 * the generic ApiDirectScrape POST stage via `PAYBOX_SHAPE.resultGuard`.
 *
 * <p>Why this exists: the balance step's `fallbackOnFail: 0` masks a
 * rejected `/sync` as `balance === 0`. When `/getUserHistory` then yields
 * an empty page, the run completes as a SILENT `success([])` — zero
 * transactions, no error. This guard converts that exact shape into a
 * LOUD, typed failure so a broken scrape surfaces instead of looking
 * like an empty wallet.
 *
 * <p>The guard deliberately names no cause. An earlier revision blamed a
 * degraded warm-session token, but a real run reproduced the identical
 * signature immediately after a full re-authentication with a
 * seconds-old token, so the token is not implicated. The message points
 * at the api-direct response diagnostics instead of asserting a
 * diagnosis the guard cannot make from a summary alone.
 *
 * <p>The guard keys on the balance-step OUTCOME (`balanceDegraded`), never
 * on the balance VALUE: with `fallbackOnFail: 0` the value is `0` whether
 * `/sync` returned a real zero (healthy empty wallet — must NOT fire) or
 * fell back from a rejection (degraded token — MUST fire). The value
 * cannot distinguish the two; the outcome can.
 *
 * <p>Scope is PayBox-only by construction: only `PAYBOX_SHAPE` wires this
 * guard. OneZero / Pepper share `fallbackOnFail: 0` but declare no
 * `resultGuard`, so their empty-but-healthy runs stay successful.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IApiDirectScrapeGuardSummary } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';

/**
 * PII-free operator message. Contains no account identifiers, no balance
 * figures, and no digit run that could be mistaken for one — only the
 * diagnosis and the remedy.
 *
 * <p>It deliberately makes no claim about whether re-authentication
 * clears the condition. The guard observes only the summary counters, so
 * any statement about auth would be a guess — and a wrong one: forensic
 * run 31015484475 hit this signature on a session that had just
 * completed a full OTP login.
 */
const PAYBOX_DEGRADED_SCRAPE_MSG =
  'PayBox scrape returned zero transactions while the balance fetch fell back ' +
  'to its default. Inspect the api-direct fetch STATUS diagnostics ' +
  '(respLength / errorCode) to tell a rejected request from a genuinely ' +
  'empty page.';

/**
 * True when the scrape produced at least one account, zero transactions
 * across all of them, AND the balance step fell back (degraded outcome).
 * @param summary - PII-free scrape summary from the POST stage.
 * @returns Whether the degraded-empty signature is present.
 */
function isDegradedEmpty(summary: IApiDirectScrapeGuardSummary): boolean {
  return summary.accountCount >= 1 && summary.totalTxns === 0 && summary.balanceDegraded;
}

/**
 * Fail-closed guard for PayBox scrape results.
 * @param summary - PII-free scrape summary from the POST stage.
 * @returns Failure when the zero-txns + degraded-balance signature is
 *   present; otherwise a pass-through success.
 */
export function payBoxResultGuard(summary: IApiDirectScrapeGuardSummary): Procedure<void> {
  if (isDegradedEmpty(summary)) return fail(ScraperErrorTypes.Generic, PAYBOX_DEGRADED_SCRAPE_MSG);
  return succeed(undefined);
}

export { PAYBOX_DEGRADED_SCRAPE_MSG };
