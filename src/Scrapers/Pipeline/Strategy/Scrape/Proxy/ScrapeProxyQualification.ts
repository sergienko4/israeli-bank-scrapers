/**
 * Proxy qualification — template discovery + card qualification.
 * Extracted from ScrapeDiscoveryStep.ts to respect max-lines.
 */

import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../Mediator/Network/NetworkDiscovery.js';
import { PIPELINE_WELL_KNOWN_API } from '../../../Registry/WK/ScrapeWK.js';
import { getDebug as createLogger } from '../../../Types/Debug.js';
import { some } from '../../../Types/Option.js';
import type {
  IApiFetchContext,
  IPipelineContext,
  IScrapeDiscovery,
} from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { succeed } from '../../../Types/Procedure.js';
import {
  extractAllCardIds,
  type IQualifyCtx,
  qualifyAllCards,
  resolveCardIds,
} from '../Account/ScrapeQualification.js';
import type { IsSignatureKey, JsonNode } from '../JsonTraversalStrategy.js';
import { bodyHasSignature } from '../JsonTraversalStrategy.js';
import {
  findProxyAccountTemplate,
  findProxyTxnTemplate,
  generateBillingMonths,
} from './ProxyScrapeReplayStrategy.js';

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
/** Card index identifier from DashboardMonth. */
type CardIndex = string;

/** Resolved template with card IDs. */
interface IResolvedTemplate {
  readonly txnUrl: EndpointUrl;
  readonly templateBody: Record<string, unknown>;
  readonly allCardIds: readonly string[];
}

/** Account signature for DashboardMonth responses. */
const ACCOUNT_SIG = /billing|charges|cardsCharges/i;

/**
 * Extract cardIndex from an array of objects.
 * @param arr - Array of record objects.
 * @returns Card index strings (non-empty).
 */
/**
 * Extract cardIndex string from an object — empty if not string.
 * @param item - Object with potential cardIndex field.
 * @returns cardIndex string or empty.
 */
function getCardIndex(item: Record<string, unknown>): CardIndex {
  const raw = item.cardIndex;
  if (typeof raw === 'string') return raw;
  return '';
}

/**
 * Extract card indices from an array of objects.
 * @param arr - Array of record objects.
 * @returns Card index strings (non-empty).
 */
function extractIndicesFromArray(arr: readonly unknown[]): readonly string[] {
  return arr
    .filter((item): IsSignatureKey => typeof item === 'object' && item !== null)
    .map((item): CardIndex => getCardIndex(item as Record<string, unknown>))
    .filter((idx): IsSignatureKey => idx !== '');
}

/**
 * BFS search for first array with cardIndex objects — single level.
 * @param body - Parsed response body (one level).
 * @returns Card index strings, or empty.
 */
function findCardIndicesInLevel(body: Record<string, unknown>): readonly string[] {
  const arrays = Object.values(body).filter(Array.isArray);
  const results = arrays.map((arr): readonly string[] =>
    extractIndicesFromArray(arr as readonly unknown[]),
  );
  const found = results.find((r): IsSignatureKey => r.length > 0);
  return found ?? [];
}

/**
 * Extract card indices from a DashboardMonth-style response body.
 * BFS: checks top level, then one level deeper.
 * @param body - Parsed response body.
 * @returns Array of card index strings.
 */
function extractCardIndices(body: JsonNode): readonly string[] {
  if (!body || typeof body !== 'object') return [];
  const record = body as Record<string, unknown>;
  const topLevel = findCardIndicesInLevel(record);
  if (topLevel.length > 0) return topLevel;
  return extractCardIndicesDeep(record);
}

/**
 * One-level-deeper BFS for card indices.
 * @param record - Top-level record.
 * @returns Card indices from nested objects.
 */
function extractCardIndicesDeep(record: Record<string, unknown>): readonly string[] {
  const values = Object.values(record);
  /** Nested object type for BFS. */
  type NestedRecord = Record<string, object>;
  const nested = values
    .filter((v): IsSignatureKey => typeof v === 'object' && v !== null && !Array.isArray(v))
    .map((v): NestedRecord => v as NestedRecord);
  const results = nested.map(findCardIndicesInLevel);
  const found = results.find((r): IsSignatureKey => r.length > 0);
  return found ?? [];
}

/**
 * Build virtual template from proxyUrl + WK when no txn traffic captured.
 * @param pq - Proxy qualification context.
 * @param allEndpoints - All captured endpoints.
 * @returns Virtual template + card IDs, or false.
 */
function buildVirtualTemplate(
  pq: IProxyQualCtx,
  allEndpoints: readonly IDiscoveredEndpoint[],
): IResolvedTemplate | false {
  const proxyUrl = pq.input.diagnostics.discoveredProxyUrl;
  if (!proxyUrl) return false;
  const acctEndpoint = findProxyAccountTemplate(allEndpoints);
  if (!acctEndpoint) return false;
  const body = acctEndpoint.responseBody as JsonNode;
  if (!bodyHasSignature(body, ACCOUNT_SIG)) return false;
  const cardIndices = extractCardIndices(body);
  if (cardIndices.length === 0) return false;
  const pattern = PIPELINE_WELL_KNOWN_API.proxyTransactions[0];
  const reqName = pattern.source.replaceAll('\\', '');
  const txnUrl = `${proxyUrl}?reqName=${reqName}`;
  const txnParams = pq.input.config.auth?.params?.transactions ?? {};
  const idxStr = cardIndices.join(', ');
  process.stderr.write(`[SCRAPE.PRE] virtual template: ${txnUrl} cards=[${idxStr}]\n`);
  return { txnUrl, templateBody: txnParams as Record<string, unknown>, allCardIds: cardIndices };
}

/**
 * Find template and resolve card IDs — organic traffic first, then virtual fallback.
 * @param pq - Proxy qualification context.
 * @returns Template + cards, or false if no template.
 */
function resolveTemplateAndCards(pq: IProxyQualCtx): IResolvedTemplate | false {
  const allEndpoints = pq.network.getAllEndpoints();
  const txnTemplate = findProxyTxnTemplate(allEndpoints);
  if (txnTemplate && txnTemplate.postData) {
    const templateBody = JSON.parse(txnTemplate.postData) as Record<string, unknown>;
    const creds = pq.input.credentials as Record<string, string>;
    const uniqueIds = extractAllCardIds(allEndpoints);
    const allCardIds = resolveCardIds(uniqueIds, creds);
    return { txnUrl: txnTemplate.url, templateBody, allCardIds };
  }
  // Virtual fallback — synthesize from proxyUrl + WK
  return buildVirtualTemplate(pq, allEndpoints);
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
/**
 * Fast path: skip probe, all cards qualified (DashboardMonth already validated).
 * @param pq - Proxy qualification context.
 * @param resolved - Resolved virtual template.
 * @returns Updated context with all cards qualified.
 */
function buildDirectDiscovery(
  pq: IProxyQualCtx,
  resolved: IResolvedTemplate,
): Procedure<IPipelineContext> {
  const startMs = new Date(pq.input.options.startDate).getTime();
  const billingMonths = generateBillingMonths(startMs);
  const disc: IScrapeDiscovery = {
    qualifiedCards: [...resolved.allCardIds],
    prunedCards: [],
    txnTemplateUrl: resolved.txnUrl,
    txnTemplateBody: resolved.templateBody,
    billingMonths,
  };
  return succeed({ ...pq.input, diagnostics: pq.diag, scrapeDiscovery: some(disc) });
}

/**
 * Run proxy qualification with unwrapped context.
 * PROXY strategy: skip probe, all cards from DashboardMonth are qualified.
 * DIRECT strategy: probe each card via API.
 * @param pq - Proxy qualification context.
 * @returns Updated context with scrapeDiscovery.
 */
async function runProxyQualification(pq: IProxyQualCtx): Promise<Procedure<IPipelineContext>> {
  const resolved = resolveTemplateAndCards(pq);
  if (!resolved) {
    LOG.debug('[SCRAPE.PRE] no replayable txn template found');
    return succeed({ ...pq.input, diagnostics: pq.diag });
  }
  // PROXY: skip probe — DashboardMonth already validated these cards
  const isProxy = pq.input.diagnostics.apiStrategy === 'PROXY';
  if (isProxy) return buildDirectDiscovery(pq, resolved);
  const cardCount = String(resolved.allCardIds.length);
  LOG.debug('[SCRAPE.PRE] qualifying %s cards', cardCount);
  return qualifyAndBuild(pq, resolved);
}

export type { IProxyQualCtx };
export { runProxyQualification };
