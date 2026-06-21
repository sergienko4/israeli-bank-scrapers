/**
 * PayBox fail-closed result guard.
 *
 * A warm PayBox session can silently degrade: the cached token still
 * resolves an identity (≥1 account) but the balance `/sync` call is
 * rejected and `getUserHistory` returns HTTP 200 with an empty body.
 * With `fallbackOnFail: 0` masking the rejected balance, that path
 * assembles a valid-looking scrape of zero transactions and reports
 * `success([])` — indistinguishable, on the data alone, from a
 * genuinely empty wallet. The only empirically-defensible
 * discriminator is the balance-step OUTCOME (did it fall back?), since
 * the balance VALUE is `0` in both cases.
 *
 * This guard fires IFF an identity was resolved AND zero transactions
 * were mapped AND the balance step degraded — failing closed so a
 * degraded warm session is caught in unit/integration rather than only
 * surfacing as 0 transactions in a live run. A healthy empty wallet
 * (`/sync` 200, balance not degraded) does NOT fire.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { IApiDirectScrapeSummary } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';

/**
 * PII-safe failure message — no token, account id, balance value, or
 * digit run ≥4 (logging-pii-guidlines). Explains WHY the run failed
 * closed so an operator can act without re-running the live E2E.
 */
const PAYBOX_EMPTY_RESULT_MESSAGE =
  'PayBox warm session returned no transactions while the balance step degraded; ' +
  'failing closed instead of reporting a silent empty result.';

/**
 * Fail-closed guard for a degraded warm PayBox scrape.
 * @param summary - PII-safe scrape summary from the generic phase.
 * @returns Success when accepted; typed failure when degraded-empty.
 */
function payBoxEmptyResultGuard(summary: IApiDirectScrapeSummary): Procedure<void> {
  if (summary.accountCount < 1) return succeed(undefined);
  if (summary.totalTxns !== 0) return succeed(undefined);
  if (!summary.balanceDegraded) return succeed(undefined);
  return fail(ScraperErrorTypes.Generic, PAYBOX_EMPTY_RESULT_MESSAGE);
}

export { PAYBOX_EMPTY_RESULT_MESSAGE, payBoxEmptyResultGuard };
