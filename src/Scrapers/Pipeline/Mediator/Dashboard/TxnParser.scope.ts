/**
 * TxnParser — multi-account scope detection helpers.
 *
 * <p>Co-located sibling of {@link "./TxnParser.js"} carrying the
 * plural-array scope DFS the harvest builder uses to decide whether
 * SCRAPE can reuse a captured response for a single-account
 * iteration. Split out so the parent file stays under the LoC cap.
 *
 * <p>SCRAPE refuses to reuse a body whose top-level (or near-top)
 * carries a WK `accountContainers` array with more than one entry —
 * the records span many cards/accounts and the matrix-loop strategy
 * must own per-card iteration instead.
 */

import { PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT } from '../../Registry/WK/ScrapeWK.js';

/**
 * JSON-shaped value the multi-scope DFS may walk over. Named alias so
 * the helpers stay free of bare `unknown` (architecture rule
 * `no-restricted-syntax`).
 */
export type JsonScopeValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonScopeValue[]
  | {
      readonly [key: string]: JsonScopeValue;
    };

/**
 * Plural-array container keys whose presence in the captured body
 * marks it as a multi-account / multi-card scope.
 */
const PLURAL_SCOPE_KEYS: readonly string[] = WK_ACCT.containers;

/** Maximum depth the multi-scope scan visits. */
const MULTI_SCOPE_MAX_DEPTH = 4;

/**
 * Returns true when `node` carries any of the plural-scope keys with
 * an array of length > 1 — i.e. the captured body bundles multiple
 * cards / accounts.
 * @param node - Inspected node.
 * @returns True on direct plural match.
 */
function nodeHasPluralScope(node: Readonly<Record<string, unknown>>): boolean {
  return PLURAL_SCOPE_KEYS.some((key): boolean => {
    const value = node[key];
    return Array.isArray(value) && value.length > 1;
  });
}

/**
 * Type guard — true when the supplied value is a plain object suitable
 * for further descent (i.e. not null, not an array, not a primitive).
 * @param value - JSON-shaped value to classify.
 * @returns True when the value is an object that can carry nested keys.
 */
function isDescendableObject(
  value: JsonScopeValue,
): value is Readonly<Record<string, JsonScopeValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Recursive DFS — bounded by {@link MULTI_SCOPE_MAX_DEPTH}. Returns
 * true the first time any node carries a plural-scope key with an
 * array of length > 1.
 * @param node - Inspected object node.
 * @param depth - Current recursion depth.
 * @returns True when a plural-scope match exists at or below `node`.
 */
function scanForPluralScope(
  node: Readonly<Record<string, JsonScopeValue>>,
  depth: number,
): boolean {
  if (nodeHasPluralScope(node)) return true;
  if (depth >= MULTI_SCOPE_MAX_DEPTH) return false;
  const childObjects = Object.values(node).filter(isDescendableObject);
  return childObjects.some((child): boolean => scanForPluralScope(child, depth + 1));
}

/**
 * Walk the captured response body up to a small depth and look for
 * any of the plural-scope keys carrying an array with more than one
 * record. Bounded recursion keeps the scan O(n) over the body.
 * @param body - Captured response body sample.
 * @returns True when the body bundles multiple cards / accounts.
 */
function detectMultiAccountScope(body: Readonly<Record<string, unknown>>): boolean {
  return scanForPluralScope(body as Readonly<Record<string, JsonScopeValue>>, 0);
}

export { detectMultiAccountScope };
