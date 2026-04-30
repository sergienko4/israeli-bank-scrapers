/**
 * Proxy qualification — template discovery + card qualification.
 * Extracted from ScrapeDiscoveryStep.ts to respect max-lines.
 */

import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../Mediator/Network/NetworkDiscovery.js';
import type { IsSignatureKey, JsonNode } from '../../../Mediator/Scrape/JsonTraversal.js';
import { bodyHasSignature } from '../../../Mediator/Scrape/JsonTraversal.js';
import { ACCOUNT_SIGNATURE_KEYS, PIPELINE_WELL_KNOWN_API } from '../../../Registry/WK/ScrapeWK.js';
import { getDebug as createLogger } from '../../../Types/Debug.js';
import { some } from '../../../Types/Option.js';
import type {
  IApiFetchContext,
  IPipelineContext,
  IScrapeDiscovery,
} from '../../../Types/PipelineContext.js';
import { API_STRATEGY } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { succeed } from '../../../Types/Procedure.js';
import { getFutureMonths } from '../../../Types/ScraperDefaults.js';
import {
  extractAllCardIds,
  type IQualifyCtx,
  qualifyAllCards,
  resolveCardIds,
} from '../Account/ScrapeQualification.js';
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
  readonly cardDisplayMap: ReadonlyMap<string, string>;
}

/** Account signature for DashboardMonth responses — reuses WK registry. */
const ACCOUNT_SIG = ACCOUNT_SIGNATURE_KEYS;

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

/** Display name for a card (last 4 digits or full number). */
type CardDisplayName = string;

/**
 * Extract cardNumber (display name) from an object.
 * Old scraper uses cardCharge.cardNumber from DashboardMonth.
 * @param item - Object with potential cardNumber field.
 * @returns cardNumber string or empty.
 */
function getCardNumber(item: Record<string, unknown>): CardDisplayName {
  const raw = item.cardNumber;
  if (typeof raw === 'string') return raw;
  return '';
}

/**
 * Build cardIndex → cardNumber display map from DashboardMonth data.
 * @param arr - Array of card charge objects.
 * @returns Map of cardIndex to cardNumber.
 */
/**
 * Extract one card's display entry from a record.
 * @param record - Object with potential cardIndex + cardNumber.
 * @returns [index, name] tuple, or false.
 */
function extractOneCardEntry(
  record: Record<string, unknown>,
): readonly [CardIndex, CardDisplayName] | false {
  const idx = getCardIndex(record);
  if (!idx) return false;
  const name = getCardNumber(record);
  if (!name) return false;
  return [idx, name] as const;
}

/**
 * Build cardIndex → cardNumber display map from DashboardMonth data.
 * @param arr - Array of card charge objects.
 * @returns Map of cardIndex to cardNumber.
 */
function buildCardDisplayMap(arr: readonly unknown[]): ReadonlyMap<CardIndex, CardDisplayName> {
  const objects = arr.filter((item): IsSignatureKey => typeof item === 'object' && item !== null);
  const entries = objects
    .map((obj): readonly [CardIndex, CardDisplayName] | false =>
      extractOneCardEntry(obj as Record<string, unknown>),
    )
    .filter((e): IsSignatureKey => e !== false);
  return new Map(entries as [CardIndex, CardDisplayName][]);
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
 * Extract cardIndex → cardNumber map from DashboardMonth body.
 * BFS: checks top level arrays, then one level deeper.
 * @param body - Parsed response body.
 * @returns Display map (may be empty if cardNumber not present).
 */
/**
 * Try building display map from arrays at one level.
 * @param record - Object to scan.
 * @returns Display map or false if none found.
 */
function tryDisplayMapFromLevel(
  record: Record<string, unknown>,
): ReadonlyMap<string, string> | false {
  const arrays = Object.values(record).filter(Array.isArray);
  const maps = arrays.map(
    (arr): ReadonlyMap<string, string> => buildCardDisplayMap(arr as readonly unknown[]),
  );
  const found = maps.find((m): IsSignatureKey => m.size > 0);
  return found ?? false;
}

/**
 * Extract cardIndex → cardNumber map from DashboardMonth body.
 * BFS: checks top level arrays, then one level deeper.
 * @param body - Parsed response body.
 * @returns Display map (may be empty if cardNumber not present).
 */
function extractCardDisplayMap(body: JsonNode): ReadonlyMap<string, string> {
  if (!body || typeof body !== 'object') return new Map();
  const record = body as Record<string, unknown>;
  const topLevel = tryDisplayMapFromLevel(record);
  if (topLevel) return topLevel;
  const nested = Object.values(record).filter(
    (v): IsSignatureKey => typeof v === 'object' && v !== null && !Array.isArray(v),
  );
  const deepMaps = nested.map((v): ReadonlyMap<string, string> | false =>
    tryDisplayMapFromLevel(v as Record<string, unknown>),
  );
  const found = deepMaps.find((m): IsSignatureKey => m !== false);
  if (!found) return new Map();
  return found;
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
  const cardDisplayMap = extractCardDisplayMap(body);
  const pattern = PIPELINE_WELL_KNOWN_API.proxyTransactions[0];
  const reqName = pattern.source.replaceAll('\\', '');
  const txnUrl = `${proxyUrl}?reqName=${reqName}`;
  const txnParams = pq.input.config.auth?.params?.transactions ?? {};
  LOG.debug({ template: txnUrl, cards: cardIndices });
  const templateBody = txnParams as Record<string, unknown>;
  return {
    txnUrl,
    templateBody,
    allCardIds: cardIndices,
    cardDisplayMap,
  };
}

/**
 * Find template and resolve card IDs — organic traffic first, then virtual fallback.
 * @param pq - Proxy qualification context.
 * @returns Template + cards, or false if no template.
 */
function resolveTemplateAndCards(pq: IProxyQualCtx): IResolvedTemplate | false {
  const allEndpoints = pq.network.getAllEndpoints();
  const txnTemplate = findProxyTxnTemplate(allEndpoints);
  if (txnTemplate === false) {
    return buildVirtualTemplate(pq, allEndpoints);
  }
  if (!txnTemplate.postData) {
    return buildVirtualTemplate(pq, allEndpoints);
  }
  const templateBody = JSON.parse(txnTemplate.postData) as Record<string, unknown>;
  const creds = pq.input.credentials as Record<string, string>;
  const uniqueIds = extractAllCardIds(allEndpoints);
  const allCardIds = resolveCardIds(uniqueIds, creds);
  const emptyMap = new Map<string, string>();
  return { txnUrl: txnTemplate.url, templateBody, allCardIds, cardDisplayMap: emptyMap };
}

/** Bundled qualification results for building discovery. */
interface IBuildDiscoveryArgs {
  readonly qualified: readonly string[];
  readonly pruned: readonly string[];
  readonly qCtx: IQualifyCtx;
  readonly billingMonths: readonly string[];
  readonly cardDisplayMap: ReadonlyMap<string, string>;
  /** Live network snapshot — populates sealed IScrapeDiscovery for ACTION. */
  readonly network: INetworkDiscovery;
}

/**
 * Build IScrapeDiscovery from qualification results.
 * Snapshots the live network (endpoints + auth) into the sealed carrier
 * so ACTION-phase consumers (proxyScrape → fetchAndMergePending) can
 * reconstruct a frozen network without live-mediator access (Rule #20/#21).
 * @param args - Bundled qualification results.
 * @returns Scrape discovery with frozen-network snapshot.
 */
async function buildDiscovery(args: IBuildDiscoveryArgs): Promise<IScrapeDiscovery> {
  const cachedAuth = await args.network.discoverAuthToken();
  return {
    qualifiedCards: args.qualified,
    prunedCards: args.pruned,
    txnTemplateUrl: args.qCtx.txnUrl,
    txnTemplateBody: args.qCtx.templateBody,
    billingMonths: args.billingMonths,
    cardDisplayMap: args.cardDisplayMap,
    frozenEndpoints: [...args.network.getAllEndpoints()],
    cachedAuth,
    rawAccountRecords: [],
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
  const futureMonths = getFutureMonths(pq.input.options);
  const billingMonths = generateBillingMonths(startMs, futureMonths);
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
  const disc = await buildDiscovery({
    qualified: accum.qualified,
    pruned: accum.pruned,
    qCtx,
    billingMonths,
    cardDisplayMap: resolved.cardDisplayMap,
    network: pq.network,
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
async function buildDirectDiscovery(
  pq: IProxyQualCtx,
  resolved: IResolvedTemplate,
): Promise<Procedure<IPipelineContext>> {
  const startMs = new Date(pq.input.options.startDate).getTime();
  const futureMonths = getFutureMonths(pq.input.options);
  const billingMonths = generateBillingMonths(startMs, futureMonths);
  const cachedAuth = await pq.network.discoverAuthToken();
  const disc: IScrapeDiscovery = {
    qualifiedCards: [...resolved.allCardIds],
    prunedCards: [],
    txnTemplateUrl: resolved.txnUrl,
    txnTemplateBody: resolved.templateBody,
    billingMonths,
    cardDisplayMap: resolved.cardDisplayMap,
    frozenEndpoints: [...pq.network.getAllEndpoints()],
    cachedAuth,
    rawAccountRecords: [],
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
    LOG.debug({
      message: '[SCRAPE.PRE] no replayable txn template found',
    });
    return succeed({ ...pq.input, diagnostics: pq.diag });
  }
  // PROXY: skip probe — DashboardMonth already validated these cards
  const isProxy = pq.input.diagnostics.apiStrategy === API_STRATEGY.PROXY;
  if (isProxy) return await buildDirectDiscovery(pq, resolved);
  const cardCount = String(resolved.allCardIds.length);
  LOG.debug({
    message: `[SCRAPE.PRE] qualifying ${cardCount} cards`,
  });
  return qualifyAndBuild(pq, resolved);
}

export type { IProxyQualCtx };
export { runProxyQualification };
