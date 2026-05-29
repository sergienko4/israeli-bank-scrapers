/**
 * Container claim — walks a single record once and assigns each
 * physical key to the LONGEST WK_ACCT.containers name that suffix-
 * matches it. Without longest-match-wins the same `bankAccounts`
 * array would be attributed to BOTH `accounts` and `bankAccounts`,
 * double-counting every record.
 *
 * Sub-split out of AccountExtractor during Phase 5 to keep each
 * cluster file under the per-cluster max-lines:150 eff cap (master
 * plan pipeline-decoupling-master-2026-05-28 / phase-5).
 */

import { PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT } from '../../../Registry/WK/ScrapeWK.js';
import { getDebug } from '../../../Types/Debug.js';
import type { ApiRecord, UntypedValue } from '../AutoMapperFacade/AutoMapperTypes.js';
import {
  findFieldValue,
  flattenObjectTree,
  isSearchableObject,
} from '../BfsFieldSearch/BfsFieldSearch.js';

const LOG = getDebug(import.meta.url);

/**
 * Check if a value is a plain object with at least one
 * `WK_ACCT.id` field (any of the queryId / displayId aliases).
 * Used to recognize account-shape records that don't carry
 * txn-signature fields (e.g. Hapoalim's /general/accounts:
 * `[{bankNumber,branchNumber,accountNumber,…}]`).
 * @param v - Candidate value.
 * @returns True when v looks like an account record.
 */
function looksLikeAccountRecord(v: UntypedValue): boolean {
  if (!isSearchableObject(v)) return false;
  const hit = findFieldValue(v as ApiRecord, WK_ACCT.id);
  return hit !== false;
}

/** Per-record key index built once per record (preserves casing). */
interface IRecordKeyIndex {
  readonly originalKeys: readonly string[];
  readonly lowerKeys: readonly string[];
}

/**
 * Build a per-record key index — pairs original-case keys with
 * lower-cased copies so each suffix probe avoids re-casing.
 * @param record - Object whose keys to index.
 * @returns Key index.
 */
function indexRecordKeys(record: ApiRecord): IRecordKeyIndex {
  const originalKeys = Object.keys(record);
  const lowerKeys = originalKeys.map((k): string => k.toLowerCase());
  return { originalKeys, lowerKeys };
}

/**
 * Filter the array under `record[originalKey]` to account-shape
 * records only. Returns the empty array when the value is not a
 * non-empty array of account-shape records — caller skips assigning.
 * @param record - Parent record.
 * @param originalKey - Key into the record.
 * @returns Account-shape records, possibly empty.
 */
function pickAccountObjectsFromKey(record: ApiRecord, originalKey: string): readonly ApiRecord[] {
  const value = record[originalKey];
  if (!Array.isArray(value) || value.length === 0) return [];
  const filtered = value.filter(looksLikeAccountRecord);
  return filtered.map((v): ApiRecord => v as ApiRecord);
}

/** Per-WK probe outcome — successful claim or skip-with-reason. */
interface IClaimAttempt {
  readonly claimedLowerKey: string | false;
  readonly objects: readonly ApiRecord[];
}

const NO_CLAIM: IClaimAttempt = { claimedLowerKey: false, objects: [] };

/** Bundled args for {@link probeContainerForWk}. */
interface IProbeArgs {
  readonly record: ApiRecord;
  readonly keys: IRecordKeyIndex;
  readonly wantedLower: string;
  readonly claimedLower: ReadonlySet<string>;
}

/**
 * Probe one record for the longest-suffix match of `wantedLower`
 * among unclaimed keys. Returns the claim metadata so the caller
 * mutates `assigned` and `claimedKeys` in one place — keeps the
 * loop body shallow per the project's max-depth=1 rule.
 * @param args - Bundled probe args.
 * @returns Claim attempt metadata.
 */
function probeContainerForWk(args: IProbeArgs): IClaimAttempt {
  const matchIdx = args.keys.lowerKeys.findIndex(
    (lk): boolean => !args.claimedLower.has(lk) && lk.endsWith(args.wantedLower),
  );
  if (matchIdx < 0) return NO_CLAIM;
  const originalKey = args.keys.originalKeys[matchIdx];
  const objects = pickAccountObjectsFromKey(args.record, originalKey);
  if (objects.length === 0) return NO_CLAIM;
  return { claimedLowerKey: args.keys.lowerKeys[matchIdx], objects };
}

/** Bundled args for {@link applyClaimAttempt} so the call stays flat. */
interface IApplyArgs {
  readonly attempt: IClaimAttempt;
  readonly wkName: string;
  readonly assigned: Record<string, ApiRecord[]>;
  readonly claimed: Set<string>;
}

/**
 * Apply one probe outcome — claim the lower-cased key and append
 * extracted records to the per-WK bucket. No-op when the attempt
 * surfaced no claim.
 * @param args - Bundled apply args.
 * @returns The same `assigned` map (chain-friendly).
 */
function applyClaimAttempt(args: IApplyArgs): Record<string, ApiRecord[]> {
  if (args.attempt.claimedLowerKey === false) return args.assigned;
  args.claimed.add(args.attempt.claimedLowerKey);
  const bucket = args.assigned[args.wkName] ?? [];
  bucket.push(...args.attempt.objects);
  args.assigned[args.wkName] = bucket;
  return args.assigned;
}

/**
 * Walks `record` once and assigns each PHYSICAL key to the LONGEST
 * WK name that suffix-matches it. Returns the mutated `assigned`
 * map so callers chain rather than rely on implicit mutation.
 * @param record - One record from the body's flattened tree.
 * @param wkNames - WK container names sorted longest-first.
 * @param assigned - Per-WK-name records, mutated in place.
 * @returns The same `assigned` object (chain-friendly).
 */
function assignContainersInRecord(
  record: ApiRecord,
  wkNames: readonly string[],
  assigned: Record<string, ApiRecord[]>,
): Record<string, ApiRecord[]> {
  const keys = indexRecordKeys(record);
  const claimed = new Set<string>();
  for (const wkName of wkNames) {
    const wantedLower = wkName.toLowerCase();
    const attempt = probeContainerForWk({ record, keys, wantedLower, claimedLower: claimed });
    applyClaimAttempt({ attempt, wkName, assigned, claimed });
  }
  return assigned;
}

/**
 * Extracts every WK named container reachable from `responseBody`
 * and returns them keyed by container name. Phase 7d adds this
 * helper so ACCOUNT-RESOLVE.POST can commit BOTH `cards` AND
 * `bankAccounts` found in the same VisaCal `account/init` payload
 * (the legacy `findContainerArray` returned only the first match).
 * @param responseBody - Parsed JSON response body.
 * @returns Per-WK-name container map; absent containers omitted.
 */
function extractAllContainers(
  responseBody: ApiRecord,
): Readonly<Record<string, readonly ApiRecord[]>> {
  const wkLongestFirst = [...WK_ACCT.containers].sort((a, b): number => b.length - a.length);
  const assigned: Record<string, ApiRecord[]> = {};
  const allRecords = flattenObjectTree(responseBody);
  for (const r of allRecords) assignContainersInRecord(r, wkLongestFirst, assigned);
  return assigned;
}

/**
 * Concatenate every container's records and emit the per-container
 * trace line. Extracted helper so {@link extractAccountRecords}
 * stays inside the project's cognitive-complexity ceiling.
 * @param containers - Per-WK-name container split.
 * @returns Concatenated records across every container.
 */
function flattenContainersForLog(
  containers: Readonly<Record<string, readonly ApiRecord[]>>,
): readonly ApiRecord[] {
  const containerNames = Object.keys(containers);
  const concatenated: ApiRecord[] = [];
  for (const name of containerNames) concatenated.push(...containers[name]);
  LOG.debug({
    message:
      `extractAccountRecords: ${String(concatenated.length)} items ` +
      `(${String(containerNames.length)} named containers: ${containerNames.join(',')})`,
  });
  return concatenated;
}

export { extractAllContainers, flattenContainersForLog, looksLikeAccountRecord };
