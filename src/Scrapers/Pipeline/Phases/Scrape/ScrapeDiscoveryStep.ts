/**
 * SCRAPE PRE step — forensic priming + diagnostics.
 * When trafficPrimed=false, delegates to Mediator's DashboardTrigger.
 * All WK/DOM logic in Mediator — Phase is thin orchestration only.
 */

import { triggerDashboardUi } from '../../Mediator/Dashboard/DashboardTrigger.js';
import { some } from '../../Types/Option.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

type DidPrime = boolean;

/**
 * Build the base diagnostics for scrape PRE.
 * @param input - Pipeline context.
 * @returns Updated diagnostics.
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
async function maybeForensicPrime(input: IPipelineContext): Promise<Procedure<DidPrime>> {
  const isPrimed = !input.dashboard.has || input.dashboard.value.trafficPrimed;
  if (isPrimed || !input.mediator.has) return succeed(true);
  process.stderr.write('[PHASE: SCRAPE] [PRE] trafficPrimed=false -> Forensic via Mediator\n');
  return triggerDashboardUi(input.mediator.value);
}

/**
 * SCRAPE PRE step — forensic priming + diagnostics.
 * @param _ctx - Unused.
 * @param input - Pipeline context.
 * @returns Updated context with diagnostics.
 */
async function scrapePreDiagnostics(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  await maybeForensicPrime(input);
  const diag = buildPreDiag(input);
  return succeed({ ...input, diagnostics: diag });
}

/** SCRAPE PRE step. */
const SCRAPE_PRE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'scrape-pre',
  execute: scrapePreDiagnostics,
};

export { SCRAPE_PRE_STEP, scrapePreDiagnostics };
