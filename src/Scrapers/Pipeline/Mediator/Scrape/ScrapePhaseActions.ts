/**
 * SCRAPE phase Mediator actions — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * PRE:    forensic priming + proxy qualification + diagnostics
 * ACTION: dispatch to genericAutoScrape (proxy or SPA path)
 * POST:   audit diagnostics (forensic audit table)
 * FINAL:  stamp account count for audit trail
 */

import { genericAutoScrape } from '../../Strategy/Scrape/GenericAutoScrapeStrategy.js';
import {
  type IProxyQualCtx,
  runProxyQualification,
} from '../../Strategy/Scrape/Proxy/ScrapeProxyQualification.js';
import { some } from '../../Types/Option.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import { triggerDashboardUi } from '../Dashboard/DashboardTrigger.js';
import { logForensicAudit } from './ForensicAuditAction.js';

/** Whether dashboard traffic was primed. */
type DidPrime = boolean;

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
async function maybeForensicPrime(input: IPipelineContext): Promise<Procedure<DidPrime>> {
  const isPrimed = !input.dashboard.has || input.dashboard.value.trafficPrimed;
  if (isPrimed || !input.mediator.has) return succeed(true);
  process.stderr.write('[SCRAPE.PRE] trafficPrimed=false -> Forensic via Mediator\n');
  return triggerDashboardUi(input.mediator.value);
}

/**
 * Run proxy qualification when apiStrategy=PROXY.
 * Delegates to Strategy's runProxyQualification.
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
 * PRE: Forensic priming + proxy qualification + diagnostics.
 * @param input - Pipeline context.
 * @returns Updated context with diagnostics.
 */
async function executeForensicPre(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  await maybeForensicPrime(input);
  const diag = buildPreDiag(input);
  return maybeProxyQualify(input, diag);
}

/**
 * ACTION: Dispatch to genericAutoScrape (proxy or SPA path).
 * @param input - Pipeline context with api context.
 * @returns Updated context with scraped accounts.
 */
async function executeMatrixLoop(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  return genericAutoScrape(input);
}

/**
 * POST: Audit diagnostics — forensic audit table for qualified/pruned cards.
 * @param input - Pipeline context after scraping.
 * @returns Updated context with post diagnostics.
 */
function executeValidateResults(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const accountCount = (input.scrape.has && input.scrape.value.accounts.length) || 0;
  const countStr = String(accountCount);
  if (input.scrapeDiscovery.has) logForensicAudit(input);
  const diag = { ...input.diagnostics, lastAction: `scrape-post (${countStr} accounts)` };
  const result = succeed({ ...input, diagnostics: diag });
  return Promise.resolve(result);
}

/**
 * FINAL: Stamp account count for audit trail.
 * @param input - Pipeline context with scrape state.
 * @returns Updated context with lastAction diagnostic.
 */
function executeStampAccounts(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const count = (input.scrape.has && input.scrape.value.accounts.length) || 0;
  const label = `scrape-final (${String(count)} accounts)`;
  const diag = { ...input.diagnostics, lastAction: label };
  const result = succeed({ ...input, diagnostics: diag });
  return Promise.resolve(result);
}

export { executeForensicPre, executeMatrixLoop, executeStampAccounts, executeValidateResults };
