/**
 * Scrape qualification — behavioral card qualification via API probe.
 * Cards qualified by isSuccess response, not companyCode.
 * Extracted from ScrapeDiscoveryStep.ts to respect max-lines.
 */

import type { IDiscoveredEndpoint } from '../../../Mediator/Network/NetworkDiscovery.js';
import { extractAccountIds } from '../../../Mediator/Scrape/ScrapeAutoMapper.js';
import type { IApiFetchContext } from '../../../Types/PipelineContext.js';
import { isOk } from '../../../Types/Procedure.js';
import type { IsSignatureKey } from '../Proxy/ProxyScrapeReplayStrategy.js';
import { rateLimitPause } from '../ScrapeDataActions.js';

/** URL of a discovered API endpoint. */
type EndpointUrl = string;
/** Billing month label (e.g. '01/03/2026'). */
type BillingLabel = string;
/** Card number fragment used in probe requests. */
type CardFragment = string;

/** Accumulator for qualification probes. */
interface IQualifyAccum {
  qualified: string[];
  pruned: string[];
}

/** Context for running qualification probes. */
interface IQualifyCtx {
  readonly api: IApiFetchContext;
  readonly templateBody: Record<string, unknown>;
  readonly txnUrl: EndpointUrl;
  readonly lastMonth: BillingLabel;
}

/**
 * Extract all unique card IDs from POST bodies containing last4digits.
 * @param allEndpoints - All captured endpoints.
 * @returns Unique card ID strings.
 */
function extractAllCardIds(allEndpoints: readonly IDiscoveredEndpoint[]): readonly string[] {
  const allTxnEps = allEndpoints.filter(
    (ep: IDiscoveredEndpoint): IsSignatureKey =>
      ep.method === 'POST' && ep.postData.includes('last4digits'),
  );
  const allPostIds = allTxnEps.flatMap((ep: IDiscoveredEndpoint): readonly string[] =>
    extractAccountIds(JSON.parse(ep.postData) as Record<string, unknown>),
  );
  return [...new Set(allPostIds)];
}

/**
 * Resolve card IDs — discovered or credential fallback.
 * @param uniqueIds - Discovered card IDs.
 * @param creds - Credential map.
 * @returns Final card ID list.
 */
function resolveCardIds(
  uniqueIds: readonly string[],
  creds: Record<string, string>,
): readonly string[] {
  if (uniqueIds.length > 0) return uniqueIds;
  return [creds.card6Digits || 'default'];
}

/**
 * Classify card into qualified or pruned bucket.
 * @param resp - API response object.
 * @param cardId - Card being probed.
 * @param accum - Result accumulators.
 * @returns True after classification.
 */
function classifyCard(resp: Record<string, unknown>, cardId: string, accum: IQualifyAccum): true {
  const isApiOk: IsSignatureKey = resp.isSuccess !== false;
  const bucket = { true: accum.qualified, false: accum.pruned };
  bucket[String(isApiOk) as 'true' | 'false'].push(cardId);
  return true;
}

/**
 * Probe one card for qualification via API.
 * @param qCtx - Qualification context.
 * @param cardId - Card to probe.
 * @param accum - Result accumulators.
 * @returns True after probe completes.
 */
/** Probe request body shape. */
interface IProbeBody {
  readonly card4Number: CardFragment;
  readonly billingMonth: BillingLabel;
  readonly [key: string]: CardFragment;
}

/**
 * Build probe request body for a card.
 * @param qCtx - Qualification context.
 * @param cardId - Card to probe.
 * @returns POST body.
 */
function buildProbeBody(qCtx: IQualifyCtx, cardId: string): IProbeBody {
  return { ...qCtx.templateBody, card4Number: cardId, billingMonth: qCtx.lastMonth };
}

/**
 * Probe one card for qualification via API.
 * @param qCtx - Qualification context.
 * @param cardId - Card to probe.
 * @param accum - Result accumulators.
 * @returns True after probe completes.
 */
async function probeOneCard(
  qCtx: IQualifyCtx,
  cardId: string,
  accum: IQualifyAccum,
): Promise<true> {
  const body = buildProbeBody(qCtx, cardId);
  const probeResult = await qCtx.api.fetchPost<Record<string, unknown>>(qCtx.txnUrl, body);
  if (!isOk(probeResult)) {
    accum.pruned.push(cardId);
    return rateLimitPause(300);
  }
  classifyCard(probeResult.value, cardId, accum);
  return rateLimitPause(300);
}

/**
 * Run qualification probes for all cards sequentially.
 * @param qCtx - Qualification context.
 * @param allCardIds - Cards to qualify.
 * @returns Qualified and pruned card arrays.
 */
async function qualifyAllCards(
  qCtx: IQualifyCtx,
  allCardIds: readonly string[],
): Promise<IQualifyAccum> {
  const accum: IQualifyAccum = { qualified: [], pruned: [] };
  const seed = Promise.resolve(true as const);
  const chain = allCardIds.reduce(
    (prev: Promise<true>, cardId: string): Promise<true> =>
      prev.then((): Promise<true> => probeOneCard(qCtx, cardId, accum)),
    seed,
  );
  await chain;
  return accum;
}

export type { IQualifyAccum, IQualifyCtx };
export { extractAllCardIds, qualifyAllCards, resolveCardIds };
