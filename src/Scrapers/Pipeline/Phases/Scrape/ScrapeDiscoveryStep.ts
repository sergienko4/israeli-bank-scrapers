/**
 * SCRAPE PRE step — behavioral qualification via ApiMediator.
 * Phase 23: Cards qualified by API response, not companyCode.
 * Proxy qualification in ScrapeProxyQualification.ts.
 */

import type { IProxyQualCtx } from '../../Strategy/Scrape/ScrapeProxyQualification.js';
import { runProxyQualification } from '../../Strategy/Scrape/ScrapeProxyQualification.js';
import { some } from '../../Types/Option.js';
import type { IPipelineStep } from '../../Types/Phase.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';

type HasProxy = boolean;

/**
 * Build the base diagnostics for scrape PRE.
 * @param input - Pipeline context.
 * @returns Updated diagnostics.
 */
function buildPreDiag(input: IPipelineContext): IPipelineContext['diagnostics'] {
  const nowMs = Date.now();
  return {
    ...input.diagnostics,
    fetchStartMs: some(nowMs),
    lastAction: 'scrape-pre',
  };
}

/**
 * Check if proxy qualification should run.
 * @param input - Pipeline context.
 * @returns True if proxy bank with mediator and API.
 */
function canQualify(input: IPipelineContext): HasProxy {
  const hasProxyBank: HasProxy = Boolean(input.config.auth.loginReqName);
  return hasProxyBank && input.mediator.has && input.api.has;
}

/**
 * SCRAPE PRE step — diagnostics + behavioral qualification.
 * @param _ctx - Unused.
 * @param input - Pipeline context.
 * @returns Updated context with diagnostics and scrapeDiscovery.
 */
async function scrapePreDiagnostics(
  _ctx: IPipelineContext,
  input: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const diag = buildPreDiag(input);
  if (!canQualify(input)) return succeed({ ...input, diagnostics: diag });
  if (!input.mediator.has || !input.api.has) return succeed({ ...input, diagnostics: diag });
  const network = input.mediator.value.network;
  const api = input.api.value;
  const pq: IProxyQualCtx = { input, diag, network, api };
  return await runProxyQualification(pq);
}

/** SCRAPE PRE step. */
const SCRAPE_PRE_STEP: IPipelineStep<IPipelineContext, IPipelineContext> = {
  name: 'scrape-pre',
  execute: scrapePreDiagnostics,
};

export { SCRAPE_PRE_STEP, scrapePreDiagnostics };
