/**
 * Diag — diagnostics helpers for SCRAPE phase.
 *
 * Provides the shared logger instance, the PRE-phase diagnostics
 * builder, and the optional forensic-prime delegation. Extracted
 * from ScrapePhaseActions.ts in Phase 8.5b C4 (split for §12 cap).
 */

import { getDebug as createLogger } from '../../../Types/Debug.js';
import { some } from '../../../Types/Option.js';
import type { IPipelineContext } from '../../../Types/PipelineContext.js';
import { type Procedure, succeed } from '../../../Types/Procedure.js';
import { triggerDashboardUi } from '../ScrapeUiTrigger.js';

/** Shared logger for the SCRAPE phase. */
const LOG = createLogger('scrape-phase');

/**
 * Build the base diagnostics for scrape PRE.
 * @param input - Pipeline context.
 * @returns Updated diagnostics with fetchStartMs.
 */
function buildPreDiag(input: IPipelineContext): IPipelineContext['diagnostics'] {
  const nowMs = Date.now();
  return { ...input.diagnostics, fetchStartMs: some(nowMs), lastAction: 'scrape-pre' };
}

/**
 * Run forensic priming if dashboard was not primed.
 * Delegates to Mediator's triggerDashboardUi — zero WK in Phase.
 * @param input - Pipeline context.
 * @returns Procedure after priming attempt.
 */
async function maybeForensicPrime(input: IPipelineContext): Promise<Procedure<boolean>> {
  const isPrimed = !input.dashboard.has || input.dashboard.value.trafficPrimed;
  if (isPrimed || !input.mediator.has) return succeed(true);
  input.logger.debug({
    message: 'trafficPrimed=false -> Forensic via Mediator',
  });
  return triggerDashboardUi(input.mediator.value, input.logger);
}

export { buildPreDiag, LOG, maybeForensicPrime };
