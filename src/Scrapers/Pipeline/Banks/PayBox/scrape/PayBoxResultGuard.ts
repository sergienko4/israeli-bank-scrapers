/**
 * PayBox fail-closed scrape guard — pure data + predicate consumed by
 * the generic ApiDirectScrape POST stage via `PAYBOX_SHAPE.resultGuard`.
 *
 * <p>Why this exists: PayBox runs warm-session-token auth. A token that
 * is structurally fresh but server-side degraded makes `/sync` reject
 * (HTTP 4xx). The balance step's `fallbackOnFail: 0` masks that rejection
 * as `balance === 0`, and `/getUserHistory` then returns an empty page,
 * so the run completes as a SILENT `success([])` — zero transactions, no
 * error. This guard converts that exact shape into a LOUD, typed failure
 * so a degraded session surfaces instead of looking like an empty wallet.
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
 */
const PAYBOX_DEGRADED_TOKEN_MSG =
  'PayBox scrape returned zero transactions while the balance fetch fell back ' +
  'to its default — the warm-session token is degraded; re-authenticate.';

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
 * @returns Failure when the degraded warm-session signature is present;
 *   otherwise a pass-through success.
 */
export function payBoxResultGuard(summary: IApiDirectScrapeGuardSummary): Procedure<void> {
  if (isDegradedEmpty(summary)) return fail(ScraperErrorTypes.Generic, PAYBOX_DEGRADED_TOKEN_MSG);
  return succeed(undefined);
}

export { PAYBOX_DEGRADED_TOKEN_MSG };
