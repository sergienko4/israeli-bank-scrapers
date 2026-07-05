/**
 * AccountFromPool.Picker — response-body picker + container scorer.
 * Extracted from the AccountFromPool barrel so the per-file LoC cap
 * is honoured (phase-2e-residue).
 */

import { PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT } from '../../Registry/WK/ScrapeWK.js';
import type { ApiPayload } from '../../Strategy/Scrape/ScrapeTypes.js';
import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';
import { selectBancsAccountRecords } from '../Scrape/Bancs/BancsAccount.js';
import {
  extractAccountIds,
  extractAccountRecords,
  extractAllContainers,
  findFieldValue,
} from '../Scrape/ScrapeAutoMapper.js';
import type { IAccountDiscoveryResult } from './AccountFromPool.Types.js';

/**
 * True iff the first element of a candidate array is an object that
 * exposes an account-id field.
 * @param arr - Non-empty array peeled from the response body.
 * @returns True iff `arr[0]` carries a WK account-id field.
 */
function isAccountShapedFirstElement(arr: readonly unknown[]): boolean {
  const first = arr[0];
  if (first === null || typeof first !== 'object') return false;
  const hit = findFieldValue(first as Record<string, unknown>, [...WK_ACCT.id]);
  return hit !== false;
}

/**
 * Returns true when the FIRST element of a root-level array exposes
 * an account-id field. Strict shape check for the Hapoalim
 * `[{accountNumber,bankNumber,…}]` pattern.
 * @param ep - Captured endpoint.
 * @returns True iff body is a non-empty root array of account-shaped records.
 */
function hasRootAccountArray(ep: IDiscoveredEndpoint): boolean {
  const body = ep.responseBody;
  if (!Array.isArray(body)) return false;
  const arr = body as readonly unknown[];
  if (arr.length === 0) return false;
  return isAccountShapedFirstElement(arr);
}

/**
 * Returns the SUM of all WK named-container record counts reachable
 * from this capture's response body.
 * @param ep - Captured endpoint.
 * @returns Total record count across all WK containers in the body, or 0.
 */
function sumContainerRecords(ep: IDiscoveredEndpoint): number {
  const body = ep.responseBody;
  if (body === null) return 0;
  if (typeof body !== 'object') return 0;
  const containers = extractAllContainers(body as ApiPayload);
  let total = 0;
  for (const name of Object.keys(containers)) total += containers[name].length;
  return total;
}

/** Possible JSON leaf or branch shapes a record's own value can take. */
type FieldValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Readonly<Record<string, unknown>>
  | readonly unknown[];

/**
 * Returns true when `value` carries information.
 * @param value - Field value to test.
 * @returns True iff value carries information.
 */
function isPopulated(value: FieldValue): boolean {
  if (value === null) return false;
  if (value === undefined) return false;
  if (typeof value === 'string') return value.length > 0;
  return true;
}

/**
 * Count populated own keys on a single record.
 * @param record - First container record to score.
 * @returns Number of own keys whose value satisfies {@link isPopulated}.
 */
function countPopulatedEntries(record: Record<string, unknown>): number {
  const entries = Object.entries(record) as readonly (readonly [string, FieldValue])[];
  return entries.filter((entry): boolean => isPopulated(entry[1])).length;
}

/**
 * Counts populated own keys on the FIRST record of the FIRST WK
 * container reachable from this capture's body. Tie-break for the
 * picker when two endpoints expose containers of identical size.
 * @param ep - Captured endpoint.
 * @returns Populated-field count of the first container record, or 0.
 */
function firstRecordFieldRichness(ep: IDiscoveredEndpoint): number {
  const body = ep.responseBody;
  if (body === null || typeof body !== 'object') return 0;
  const containers = extractAllContainers(body as ApiPayload);
  const names = Object.keys(containers);
  if (names.length === 0) return 0;
  return countPopulatedEntries(containers[names[0]][0]);
}

/**
 * Count the shape-guarded BaNCS (Yahav) current DDA account records
 * reachable from this capture's body. Returns 0 for every non-BaNCS
 * bank (default-deny), so {@link scoreCandidate} is provably unchanged
 * for Leumi/Discount/VisaCal/Max/Isracard.
 * @param ep - Captured endpoint.
 * @returns 1 when the body is the BaNCS account-resolve response, else 0.
 */
function bancsAccountCount(ep: IDiscoveredEndpoint): number {
  const body = ep.responseBody;
  if (body === null || typeof body !== 'object') return 0;
  const records = selectBancsAccountRecords(body as ApiPayload);
  if (records === false) return 0;
  return records.length;
}

/** Scoring tuple used to rank pool candidates for the picker. */
interface IPoolCandidate {
  readonly endpoint: IDiscoveredEndpoint;
  readonly count: number;
  readonly richness: number;
}

/**
 * Builds a scoring tuple for one endpoint. The candidate count is the
 * larger of the WK named-container total and the shape-guarded BaNCS
 * account count, so a BaNCS account-resolve body becomes selectable
 * without inflating the WK-only {@link poolMaxContainer} guard.
 * @param ep - Captured endpoint.
 * @returns Scoring tuple.
 */
function scoreCandidate(ep: IDiscoveredEndpoint): IPoolCandidate {
  const wk = sumContainerRecords(ep);
  const bancs = bancsAccountCount(ep);
  return { endpoint: ep, count: maxNumber(wk, bancs), richness: firstRecordFieldRichness(ep) };
}

/**
 * Compares two candidates for descending-cardinality sort.
 * @param a - Left candidate.
 * @param b - Right candidate.
 * @returns Negative when a wins, positive when b wins.
 */
function compareCandidates(a: IPoolCandidate, b: IPoolCandidate): number {
  const byCount = b.count - a.count;
  if (byCount !== 0) return byCount;
  const byRichness = b.richness - a.richness;
  if (byRichness !== 0) return byRichness;
  const aIdx = a.endpoint.captureIndex ?? 0;
  const bIdx = b.endpoint.captureIndex ?? 0;
  return aIdx - bIdx;
}

/**
 * Picks the capture whose response body exposes the LARGEST WK named
 * container reachable across the entire pool. Falls back to the
 * root-array path when no endpoint exposes a named container.
 * @param pool - Pre-nav captures.
 * @returns Endpoint with the richest container, root-array fallback, or false.
 */
function pickAccountEndpoint(pool: readonly IDiscoveredEndpoint[]): IDiscoveredEndpoint | false {
  const candidates = pool.map(scoreCandidate).filter((c): boolean => c.count > 0);
  if (candidates.length > 0) {
    const sorted = [...candidates].sort(compareCandidates);
    return sorted[0].endpoint;
  }
  const rootShape = pool.find(hasRootAccountArray);
  return rootShape ?? false;
}

/**
 * Picks the larger of two numbers — keeps the no-nested-call rule happy.
 * @param a - Left value.
 * @param b - Right value.
 * @returns Larger of {@link a} and {@link b}.
 */
function maxNumber(a: number, b: number): number {
  if (a >= b) return a;
  return b;
}

/**
 * Reduces one pool entry into the running maximum sum-of-containers size.
 * @param max - Running maximum.
 * @param ep - Captured endpoint.
 * @returns New running maximum.
 */
function reduceMaxContainer(max: number, ep: IDiscoveredEndpoint): number {
  const sum = sumContainerRecords(ep);
  return maxNumber(max, sum);
}

/**
 * Returns the LARGEST sum-of-WK-containers seen across the pool.
 * ACCOUNT-RESOLVE.POST consumes this to enforce the fail-loud
 * incomplete guard.
 * @param pool - Pre-nav captures.
 * @returns Maximum sum-of-WK-container records across the pool, or 0.
 */
function poolMaxContainer(pool: readonly IDiscoveredEndpoint[]): number {
  let max = 0;
  for (const ep of pool) max = reduceMaxContainer(max, ep);
  return max;
}

/**
 * Build the response-body discovery payload from a picked endpoint.
 * @param endpoint - Picked endpoint with the richest container shape.
 * @returns Discovery carrying spread copies of ids/records + containers.
 */
function buildDiscoveryFromEndpoint(endpoint: IDiscoveredEndpoint): IAccountDiscoveryResult {
  const body = endpoint.responseBody as ApiPayload;
  const ids = extractAccountIds(body);
  const records = extractAccountRecords(body);
  const containers = extractAllContainers(body);
  return { endpoint, ids, records, containers };
}

export { buildDiscoveryFromEndpoint, pickAccountEndpoint, poolMaxContainer };
