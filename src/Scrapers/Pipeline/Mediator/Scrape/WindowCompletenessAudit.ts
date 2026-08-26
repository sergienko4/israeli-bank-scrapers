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
 * <p>`NOT_EXHAUSTED` means no shortfall was observed — either the walk
 * reached back past the requested start, or nothing ever asked. It is
 * deliberately not named `COVERED`: this line reads one flag, and a run that
 * never asked leaves that flag clear for the same reason a run that succeeded
 * does. Absence of evidence is not evidence the window was served.
 *
 * <p>`EXHAUSTED` means the backfill asked for older rows and could not get
 * them, so the set may stop short. That one is a positive observation.
 */
type WindowAuditVerdict = 'NOT_EXHAUSTED' | 'EXHAUSTED';

/**
 * Report whether any window shortfall was observed.
 *
 * <p>Exhaustion means the backfill asked for older rows and could not get
 * them, so the returned set may stop short of the requested start date. A
 * run that never had to ask is NOT exhausted: "we asked and could not get
 * more" and "we never needed to ask" are different facts, and this line is
 * what lets an operator tell them apart from the log alone. Exhaustion
 * warns because it is a recoverable-but-unexpected data shortfall; the
 * clear verdict stays at debug with the rest of the audit table.
 *
 * <p>The clear verdict claims only what one flag can prove. Per
 * `docs/observability/coverage-audit.md`, the per-account `WINDOW` lines are
 * where an operator reads actual coverage; this line is the run-level
 * shortfall alarm, and naming it `COVERED` invited it to be read as the
 * former.
 *
 * @param scrape - Committed scrape state.
 * @returns The verdict that was logged.
 */
function logWindowCompleteness(scrape: IScrapeState): WindowAuditVerdict {
  const isExhausted = scrape.backfillExhausted === true;
  if (!isExhausted) {
    LOG.debug({ stage: 'POST', message: '[AUDIT] | WINDOW | NOT_EXHAUSTED |' });
    return 'NOT_EXHAUSTED';
  }
  const reason = 'EXHAUSTED - backfill spent, rows may stop short of the requested start';
  LOG.warn({ stage: 'POST', message: `[AUDIT] | WINDOW | ${reason} |` });
  return 'EXHAUSTED';
}

export type { WindowAuditVerdict };
export { logWindowCompleteness };
