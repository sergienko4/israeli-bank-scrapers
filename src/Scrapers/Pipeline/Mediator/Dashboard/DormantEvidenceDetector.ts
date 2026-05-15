/**
 * Phase H'' (2026-05-15) — dormant-account evidence detector.
 *
 * <p>Pure synchronous function: scans the captured pool for the
 * "empty window" signal a bank emits when an account has zero
 * transactions in the SPA-default range. The signal is a captured
 * response body that carries BOTH (a) an empty array under a WK
 * `txnContainers` alias (e.g. `transactions: []`) AND (b) a WK
 * `fromDate` + WK `toDate` alias pair at any depth — proof the
 * bank reported a date-window state, not a missing endpoint.
 *
 * <p>Used by DASHBOARD.FINAL to branch the fail-loud path when
 * `resolveTxnEndpoint` returned `false`: dormant evidence → commit
 * an empty endpoint shape so SCRAPE produces `txns: []` naturally;
 * the existing `isAllAccountsEmpty` predicate in SCRAPE.POST
 * stays as the single loud signal for genuine misses. Aligns with
 * `spec.txt:162` / `spec.txt:717` — individual dormant accounts
 * succeed, only ALL-empty fails.
 *
 * <p>Zero bank-name knowledge. The container-name list, fromDate
 * alias list, and toDate alias list all come from the WK registry.
 */

import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../Registry/WK/ScrapeWK.js';
import type { Brand } from '../../Types/Brand.js';

/**
 * Branded signal — true when the captured pool proves the bank
 * reported "window empty" rather than "no endpoint". Named so
 * call-sites and Rule #15 can see the intent at a glance.
 */
export type DormantEvidenceSignal = Brand<boolean, 'DormantEvidenceSignal'>;

/**
 * Named recursive JSON-like value shape used by the dormant-evidence
 * detector. The architecture `no-restricted-syntax` rule forbids bare
 * `unknown` in function parameter / return positions; this alias
 * pins the bag of values the detector accepts without leaking
 * `unknown` past the file boundary.
 */
type DormantJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly DormantJsonValue[]
  | { readonly [key: string]: DormantJsonValue };

/** Plain-object subtype of {@link DormantJsonValue} — keys → JSON values. */
type IDormantJsonObject = Readonly<Record<string, DormantJsonValue>>;

/**
 * Subset of a captured endpoint relevant to dormant-evidence probing.
 * `responseBody` is typed `unknown` so production callers (the
 * captured endpoint pool) can pass through without a cast at the
 * call site; the detector narrows to {@link DormantJsonValue}
 * internally via the type guard.
 */
export interface IDormantProbeInput {
  readonly responseBody: unknown;
}

const TXN_CONTAINER_KEYS = new Set<string>(WK.txnContainers);
const FROM_DATE_KEYS = new Set<string>(WK.fromDate);
const TO_DATE_KEYS = new Set<string>(WK.toDate);
const MAX_SCAN_DEPTH = 6;

/**
 * Type guard — true when the value is a plain object suitable for
 * descent into its keys. Arrays are handled separately via
 * {@link collectDescendables} so the detector visits objects nested
 * inside response-body arrays (e.g. Hapoalim's
 * `homePageTiltes[0].data.transactions`).
 * @param value - JSON-shaped value.
 * @returns True when value is a non-null, non-array object.
 */
function isDescendableObject(value: DormantJsonValue): value is IDormantJsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Flatten one container value into the list of plain objects the
 * detector should recurse into. An object yields itself; an array
 * yields its object-typed elements; primitives / null yield nothing.
 * @param value - One container value.
 * @returns 0..N plain objects to descend into.
 */
function collectDescendables(value: DormantJsonValue): readonly IDormantJsonObject[] {
  if (isDescendableObject(value)) return [value];
  if (Array.isArray(value)) return value.filter(isDescendableObject);
  return [];
}

/**
 * True when `node` has any WK `txnContainers` key whose value is an
 * empty array — the canonical "no transactions in window" body shape.
 * @param node - Inspected object node.
 * @returns True on direct empty-container match.
 */
function nodeHasEmptyTxnContainer(node: IDormantJsonObject): boolean {
  return Array.from(TXN_CONTAINER_KEYS).some((key): boolean => {
    const value = node[key];
    return Array.isArray(value) && value.length === 0;
  });
}

/**
 * Recursive DFS — true the first time any reachable object node
 * carries an empty WK `txnContainers` array. Descends into BOTH
 * nested objects and object-typed elements of arrays. Bounded by
 * {@link MAX_SCAN_DEPTH}.
 * @param node - Inspected object node.
 * @param depth - Current recursion depth.
 * @returns True when an empty-container hit exists at or below `node`.
 */
function scanForEmptyContainer(node: IDormantJsonObject, depth: number): boolean {
  if (nodeHasEmptyTxnContainer(node)) return true;
  if (depth >= MAX_SCAN_DEPTH) return false;
  const children = Object.values(node).flatMap(collectDescendables);
  return children.some((child): boolean => scanForEmptyContainer(child, depth + 1));
}

/**
 * Recursive DFS — true when any reachable object node carries a key
 * matching the supplied alias set. Descends into BOTH nested objects
 * and object-typed elements of arrays. Bounded by
 * {@link MAX_SCAN_DEPTH}.
 * @param node - Inspected object node.
 * @param aliasKeys - WK alias set to look for.
 * @param depth - Current recursion depth.
 * @returns True on first matching key.
 */
function scanForAlias(
  node: IDormantJsonObject,
  aliasKeys: ReadonlySet<string>,
  depth: number,
): boolean {
  const nodeKeys = Object.keys(node);
  if (nodeKeys.some((key): boolean => aliasKeys.has(key))) return true;
  if (depth >= MAX_SCAN_DEPTH) return false;
  const children = Object.values(node).flatMap(collectDescendables);
  return children.some((child): boolean => scanForAlias(child, aliasKeys, depth + 1));
}

/**
 * Returns true when one probe body carries the full dormant signal:
 * empty WK txn-container array + WK fromDate alias + WK toDate alias
 * (any depth). Pass-through on non-object bodies.
 * @param probe - One pool entry.
 * @returns True when probe alone proves dormant state.
 */
function probeShowsDormantState(probe: IDormantProbeInput): boolean {
  // Narrow the captured-body `unknown` to the JSON-shape alias the
  // recursive scanners consume. The interface field stays `unknown`
  // so production callers (IDiscoveredEndpoint with `responseBody:
  // unknown`) can hand probes through without a cast at the
  // call site.
  const body = probe.responseBody as DormantJsonValue;
  if (!isDescendableObject(body)) return false;
  if (!scanForEmptyContainer(body, 0)) return false;
  if (!scanForAlias(body, FROM_DATE_KEYS, 0)) return false;
  return scanForAlias(body, TO_DATE_KEYS, 0);
}

/**
 * Detects whether the captured pool carries dormant-account evidence:
 * at least one response body with an empty WK txn-container array AND
 * a WK fromDate + WK toDate alias pair (any depth). Used by
 * DASHBOARD.FINAL to gate fail-loud when `resolveTxnEndpoint`
 * returned `false` — dormant evidence flips the branch to commit
 * an empty endpoint shape so SCRAPE produces `txns: []` naturally.
 *
 * @param probes - Captured pool (any phase).
 * @returns True when at least one probe shows dormant state.
 */
export default function detectDormantEvidence(
  probes: readonly IDormantProbeInput[],
): DormantEvidenceSignal {
  const isDormant = probes.some(probeShowsDormantState);
  return isDormant as DormantEvidenceSignal;
}
