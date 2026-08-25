/**
 * POST diagnostics — window-completeness verdict for a finished scrape.
 *
 * <p>Split out of `ForensicAuditAction` so the audit table and the
 * completeness verdict each stay within the file-size budget and can be
 * tested independently.
 */

import { getDebug as createLogger } from '../../Logging/Debug.js';
import type { IScrapeState } from '../../Types/Domain/ScrapeState.js';

const LOG = createLogger(import.meta.url);

/**
 * Verdict recorded by {@link logWindowCompleteness}.
 *
 * <p>`COVERED` means the walk reached back past the requested start.
 * `EXHAUSTED` means the backfill asked for older rows and could not get
 * them, so the set may stop short.
 */
type WindowAuditVerdict = 'COVERED' | 'EXHAUSTED';

/**
 * Report whether the requested window was actually covered.
 *
 * <p>Exhaustion means the backfill asked for older rows and could not get
 * them, so the returned set may stop short of the requested start date. A
 * run that never had to ask is NOT exhausted: "we asked and could not get
 * more" and "we never needed to ask" are different facts, and this line is
 * what lets an operator tell them apart from the log alone. Exhaustion
 * warns because it is a recoverable-but-unexpected data shortfall; a
 * covered window stays at debug with the rest of the audit table.
 *
 * @param scrape - Committed scrape state.
 * @returns The verdict that was logged.
 */
function logWindowCompleteness(scrape: IScrapeState): WindowAuditVerdict {
  const isExhausted = scrape.backfillExhausted === true;
  if (!isExhausted) {
    LOG.debug({ stage: 'POST', message: '[AUDIT] | WINDOW | COVERED |' });
    return 'COVERED';
  }
  const reason = 'EXHAUSTED - backfill spent, rows may stop short of the requested start';
  LOG.warn({ stage: 'POST', message: `[AUDIT] | WINDOW | ${reason} |` });
  return 'EXHAUSTED';
}

export type { WindowAuditVerdict };
export { logWindowCompleteness };
