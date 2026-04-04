/**
 * SCRAPE PRE step — forensic priming + diagnostics.
 * When trafficPrimed=false, delegates to Mediator's DashboardTrigger.
 * All WK/DOM logic in Mediator — Phase is thin orchestration only.
 */

import { triggerDashboardUi } from '../../Mediator/Dashboard/DashboardTrigger.js';
import {
  type IProxyQualCtx,
  runProxyQualification,
} from '../../Strategy/Scrape/Proxy/ScrapeProxyQualification.js';
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
/**
 * Run proxy qualification when apiStrategy=PROXY.
 * Populates scrapeDiscovery with qualified cards + billing months.
 * @param input - Pipeline context.
 * @param diag - Updated diagnostics.
 * @returns Updated context with scrapeDiscovery, or unchanged.
 */
/**
 * Run proxy qualification when apiStrategy=PROXY.
 * Delegates to Mediator's runProxyQualification — Phase is thin orchestration.
 * @param input - Pipeline context.
 * @param diag - Updated diagnostics.
 * @returns Updated context with scrapeDiscovery, or unchanged.
 */
async function maybeProxyQualify(
  input: IPipelineContext,
  diag: IPipelineContext['diagnostics'],
): Promise<Procedure<IPipelineContext>> {
  if (input.diagnostics.apiStrategy !== 'PROXY') return succeed({ ...input, diagnostics: diag });
  if (!input.mediator.has || !input.api.has) return succeed({ ...input, diagnostics: diag });
  const network = input.mediator.value.network;
  const pq: IProxyQualCtx = { input, diag, network, api: input.api.value };
  return runProxyQualification(pq);
}

/**
 * SCRAPE PRE step — forensic priming + proxy qualification + diagnostics.
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
  return maybeProxyQualify(input, diag);
}

/** SCRAPE PRE step. */
const SCRAPE_PRE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'scrape-pre',
  execute: scrapePreDiagnostics,
};

export { SCRAPE_PRE_STEP, scrapePreDiagnostics };
