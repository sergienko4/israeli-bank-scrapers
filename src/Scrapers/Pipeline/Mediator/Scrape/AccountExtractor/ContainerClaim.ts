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

/** Per-WK probe outcome — successful claim metadata. */
interface IClaimAttempt {
  readonly claimedLowerKey: string;
  readonly objects: readonly ApiRecord[];
}

/** Bundled args for {@link probeContainerForWk}. */
interface IProbeArgs {
  readonly record: ApiRecord;
  readonly keys: IRecordKeyIndex;
  readonly wantedLower: string;
  readonly claimedLower: ReadonlySet<string>;
}

/**
 * Probe one record for EVERY unclaimed suffix match of `wantedLower`.
 * Returns one IClaimAttempt per matching physical key so callers can
 * assign multiple containers from the same record (e.g. `accounts` AND
 * `bankAccounts` both ending in `bankAccounts` claim each separately).
 * Previously returned only the first match, silently dropping siblings.
 * @param args - Bundled probe args.
 * @returns Claim attempts (empty when no unclaimed suffix matches).
 */
function probeContainerForWk(args: IProbeArgs): readonly IClaimAttempt[] {
  return args.keys.lowerKeys.flatMap((lk, idx): readonly IClaimAttempt[] => {
    if (args.claimedLower.has(lk) || !lk.endsWith(args.wantedLower)) return [];
    const objects = pickAccountObjectsFromKey(args.record, args.keys.originalKeys[idx]);
    if (objects.length === 0) return [];
    return [{ claimedLowerKey: lk, objects }];
  });
}

/** Bundled args for {@link applyClaimAttempts} so the call stays flat. */
interface IApplyArgs {
  readonly attempts: readonly IClaimAttempt[];
  readonly wkName: string;
  readonly assigned: Record<string, ApiRecord[]>;
  readonly claimed: Set<string>;
}

/**
 * Apply every probe outcome — claim each lower-cased key and append
 * extracted records to the per-WK bucket. No-op when the probe surfaced
 * no claims (empty `attempts`).
 * @param args - Bundled apply args.
 * @returns The same `assigned` map (chain-friendly).
 */
function applyClaimAttempts(args: IApplyArgs): Record<string, ApiRecord[]> {
  for (const attempt of args.attempts) {
    args.claimed.add(attempt.claimedLowerKey);
    const bucket = args.assigned[args.wkName] ?? [];
    bucket.push(...attempt.objects);
    args.assigned[args.wkName] = bucket;
  }
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
    const attempts = probeContainerForWk({ record, keys, wantedLower, claimedLower: claimed });
    applyClaimAttempts({ attempts, wkName, assigned, claimed });
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
