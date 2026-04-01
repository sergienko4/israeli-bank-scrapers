/**
 * Proxy qualification — template discovery + card qualification.
 * Extracted from ScrapeDiscoveryStep.ts to respect max-lines.
 */

import type { INetworkDiscovery } from '../../Mediator/Network/NetworkDiscovery.js';
import {
  findProxyTxnTemplate,
  generateBillingMonths,
} from '../../Strategy/Scrape/ProxyScrapeReplayStrategy.js';
import { getDebug as createLogger } from '../../Types/Debug.js';
import { some } from '../../Types/Option.js';
import type {
  IApiFetchContext,
  IPipelineContext,
  IScrapeDiscovery,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import {
  extractAllCardIds,
  type IQualifyCtx,
  qualifyAllCards,
  resolveCardIds,
} from './ScrapeQualification.js';

const LOG = createLogger('scrape-proxy');

/** Bundled proxy qualification context. */
interface IProxyQualCtx {
  readonly input: IPipelineContext;
  readonly diag: IPipelineContext['diagnostics'];
  readonly network: INetworkDiscovery;
  readonly api: IApiFetchContext;
}

/** URL of a discovered API endpoint. */
type EndpointUrl = string;

/** Resolved template with card IDs. */
interface IResolvedTemplate {
  readonly txnUrl: EndpointUrl;
  readonly templateBody: Record<string, unknown>;
  readonly allCardIds: readonly string[];
}

/**
 * Find template and resolve card IDs.
 * @param pq - Proxy qualification context.
 * @returns Template + cards, or false if no template.
 */
function resolveTemplateAndCards(pq: IProxyQualCtx): IResolvedTemplate | false {
  const allEndpoints = pq.network.getAllEndpoints();
  const txnTemplate = findProxyTxnTemplate(allEndpoints);
  if (!txnTemplate || !txnTemplate.postData) return false;
  const templateBody = JSON.parse(txnTemplate.postData) as Record<string, unknown>;
  const creds = pq.input.credentials as Record<string, string>;
  const uniqueIds = extractAllCardIds(allEndpoints);
  const allCardIds = resolveCardIds(uniqueIds, creds);
  return { txnUrl: txnTemplate.url, templateBody, allCardIds };
}

/** Bundled qualification results for building discovery. */
interface IBuildDiscoveryArgs {
  readonly qualified: readonly string[];
  readonly pruned: readonly string[];
  readonly qCtx: IQualifyCtx;
  readonly billingMonths: readonly string[];
}

/**
 * Build IScrapeDiscovery from qualification results.
 * @param args - Bundled qualification results.
 * @returns Scrape discovery object.
 */
function buildDiscovery(args: IBuildDiscoveryArgs): IScrapeDiscovery {
  return {
    qualifiedCards: args.qualified,
    prunedCards: args.pruned,
    txnTemplateUrl: args.qCtx.txnUrl,
    txnTemplateBody: args.qCtx.templateBody,
    billingMonths: args.billingMonths,
  };
}

/**
 * Build qualification context from resolved template.
 * @param pq - Proxy context.
 * @param resolved - Resolved template.
 * @returns Qualification context + billing months.
 */
function buildQualCtx(
  pq: IProxyQualCtx,
  resolved: IResolvedTemplate,
): { qCtx: IQualifyCtx; billingMonths: readonly string[] } {
  const startMs = new Date(pq.input.options.startDate).getTime();
  const billingMonths = generateBillingMonths(startMs);
  const lastMonth = billingMonths.at(-1) ?? '01/01/2020';
  const qCtx: IQualifyCtx = {
    api: pq.api,
    templateBody: resolved.templateBody,
    txnUrl: resolved.txnUrl,
    lastMonth,
  };
  return { qCtx, billingMonths };
}

/**
 * Qualify cards and build discovery from resolved template.
 * @param pq - Proxy qualification context.
 * @param resolved - Resolved template with card IDs.
 * @returns Updated context with scrapeDiscovery.
 */
async function qualifyAndBuild(
  pq: IProxyQualCtx,
  resolved: IResolvedTemplate,
): Promise<Procedure<IPipelineContext>> {
  const { qCtx, billingMonths } = buildQualCtx(pq, resolved);
  const accum = await qualifyAllCards(qCtx, resolved.allCardIds);
  const disc = buildDiscovery({
    qualified: accum.qualified,
    pruned: accum.pruned,
    qCtx,
    billingMonths,
  });
  return succeed({ ...pq.input, diagnostics: pq.diag, scrapeDiscovery: some(disc) });
}

/**
 * Run proxy qualification with unwrapped context.
 * @param pq - Proxy qualification context.
 * @returns Updated context with scrapeDiscovery.
 */
async function runProxyQualification(pq: IProxyQualCtx): Promise<Procedure<IPipelineContext>> {
  const resolved = resolveTemplateAndCards(pq);
  if (!resolved) {
    LOG.debug('[SCRAPE.PRE] no replayable txn template found');
    return succeed({ ...pq.input, diagnostics: pq.diag });
  }
  const cardCount = String(resolved.allCardIds.length);
  LOG.debug('[SCRAPE.PRE] qualifying %s cards', cardCount);
  return qualifyAndBuild(pq, resolved);
}

export type { IProxyQualCtx };
export { runProxyQualification };
