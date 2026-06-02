/**
 * JSON traversal strategy — BFS tree search and key collection.
 * Replaces manual while loops with recursive reduce patterns.
 */

/** A parsed JSON node — object, array, or primitive. */
type JsonNode = Record<string, unknown> | readonly unknown[] | string | number | boolean | null;

/**
 * Check if any key of a record matches a regex pattern.
 * @param obj - Object to check keys of.
 * @param pattern - Regex to match against.
 * @returns True if at least one key matches.
 */
function objectKeysMatch(obj: Record<string, unknown>, pattern: RegExp): boolean {
  return Object.keys(obj).some((k): boolean => pattern.test(k));
}

/**
 * Extract object children from a record for BFS traversal.
 * @param record - Parent record.
 * @returns Child objects only.
 */
function objectChildren(record: Record<string, unknown>): readonly JsonNode[] {
  return Object.values(record).filter((v): v is JsonNode => Boolean(v && typeof v === 'object'));
}

/**
 * Process one BFS node — check signature and collect next-level nodes.
 * @param node - Current node.
 * @param pattern - Signature pattern.
 * @returns Found flag and children to enqueue.
 */
/**
 * Extract the first element of an array as a JsonNode list.
 * @param arr - The array to extract from.
 * @returns Single-element array or empty.
 */
function arrayFirstElement(arr: readonly unknown[]): readonly JsonNode[] {
  if (arr.length === 0) return [];
  return [arr[0] as JsonNode];
}

/** Result of processing one BFS node. */
interface INodeResult {
  readonly isFound: boolean;
  readonly children: readonly JsonNode[];
}

/**
 * Build the {@link INodeResult} for an object node — match scan first,
 * then either return the found sentinel or queue the record's
 * object-valued children for BFS. Pulled out so {@link processNode}
 * stays a flat two-branch dispatch.
 *
 * @param node - Record node from the BFS frontier.
 * @param pattern - Signature regex.
 * @returns Found/not-found result with the next BFS level seeded.
 */
function processObjectNode(node: Record<string, unknown>, pattern: RegExp): INodeResult {
  const isFound = objectKeysMatch(node, pattern);
  if (isFound) return { isFound, children: [] };
  return { isFound: false, children: objectChildren(node) };
}

/**
 * Process one BFS node — check signature and collect children.
 * @param node - Current node.
 * @param pattern - Signature pattern.
 * @returns Found flag and children to enqueue.
 */
function processNode(node: JsonNode, pattern: RegExp): INodeResult {
  if (Array.isArray(node)) {
    const first = arrayFirstElement(node);
    return { isFound: false, children: first };
  }
  if (!node || typeof node !== 'object') return { isFound: false, children: [] };
  return processObjectNode(node as Record<string, unknown>, pattern);
}

/**
 * Reducer for {@link searchLevel} — accumulates the "found" sentinel
 * across the frontier while pushing children onto the next level.
 * Pulled out so the orchestrator stays a thin reduce + recurse.
 *
 * @param nextLevel - Mutable next-frontier accumulator.
 * @param pattern - Signature regex.
 * @returns A reducer suitable for `Array.reduce<boolean>`.
 */
function buildSearchReducer(
  nextLevel: JsonNode[],
  pattern: RegExp,
): (wasFound: boolean, node: JsonNode) => boolean {
  return (wasFound, node): boolean => {
    if (wasFound) return true;
    const result = processNode(node, pattern);
    if (result.isFound) return true;
    nextLevel.push(...result.children);
    return false;
  };
}

/**
 * BFS signature search — processes one level and recurses.
 * @param level - Current BFS frontier.
 * @param pattern - Signature regex.
 * @returns True if any node's keys match the pattern.
 */
function searchLevel(level: readonly JsonNode[], pattern: RegExp): boolean {
  if (level.length === 0) return false;
  const nextLevel: JsonNode[] = [];
  const reducer = buildSearchReducer(nextLevel, pattern);
  const isMatchedInLevel = level.reduce<boolean>((acc, node) => reducer(acc, node), false);
  if (isMatchedInLevel) return true;
  return searchLevel(nextLevel, pattern);
}

/**
 * Check if a parsed JSON body contains keys matching a signature.
 * @param body - Parsed JSON response body (typed as JsonNode).
 * @param pattern - Regex to match against object keys.
 * @returns True if any key matches.
 */
function bodyHasSignature(body: JsonNode, pattern: RegExp): boolean {
  if (!body || typeof body !== 'object') return false;
  return searchLevel([body], pattern);
}

/**
 * Collect matching keys from one BFS node.
 * @param node - Current node.
 * @param pattern - Key pattern.
 * @returns Matched keys and children to enqueue.
 */
function collectFromNode(
  node: JsonNode,
  pattern: RegExp,
): { keys: readonly string[]; children: readonly JsonNode[] } {
  if (Array.isArray(node)) {
    return { keys: [], children: arrayFirstElement(node) };
  }
  if (!node || typeof node !== 'object') return { keys: [], children: [] };
  const record = node as Record<string, unknown>;
  const keys = Object.keys(record).filter((k): boolean => pattern.test(k));
  return { keys, children: objectChildren(record) };
}

/** Frontier accumulators consumed by the {@link collectKeysLevel} BFS. */
interface IKeysFrontier {
  readonly keys: string[];
  readonly nextLevel: JsonNode[];
}

/**
 * Walk one BFS frontier in-place — append matches to `keys` and
 * children to `nextLevel`. Pulled out so the recursive orchestrator
 * stays flat.
 *
 * @param level - Current BFS frontier (input).
 * @param pattern - Key pattern.
 * @param acc - Mutable accumulators (output).
 * @returns Always true (sentinel for callers).
 */
function fillKeysFrontier(level: readonly JsonNode[], pattern: RegExp, acc: IKeysFrontier): true {
  for (const node of level) {
    const result = collectFromNode(node, pattern);
    acc.keys.push(...result.keys);
    acc.nextLevel.push(...result.children);
  }
  return true;
}

/**
 * BFS key collection — processes one level and recurses.
 * @param level - Current BFS frontier.
 * @param pattern - Key pattern.
 * @returns All matching key names across all levels.
 */
function collectKeysLevel(level: readonly JsonNode[], pattern: RegExp): readonly string[] {
  if (level.length === 0) return [];
  const acc: IKeysFrontier = { keys: [], nextLevel: [] };
  fillKeysFrontier(level, pattern, acc);
  const deeper = collectKeysLevel(acc.nextLevel, pattern);
  return [...acc.keys, ...deeper];
}

/**
 * Extract all matching key names from a JSON body via BFS.
 * @param body - Parsed JSON response.
 * @param pattern - Key pattern to match.
 * @returns All matching key names.
 */
function extractMatchingKeys(body: JsonNode, pattern: RegExp): readonly string[] {
  if (!body || typeof body !== 'object') return [];
  return collectKeysLevel([body], pattern);
}

/**
 * Generate billing month strings for a date range.
 * Uses recursive month stepping instead of while loop.
 * Mirrors legacy `getAllMonthMoments(startMoment, futureMonthsToScrape)` —
 * CAL-family banks emit the current (open) billing cycle's txns inside the
 * NEXT month's CardsTransactionsList response, so callers must request at
 * least 1 future month (DEFAULT_FUTURE_MONTHS) to surface those txns.
 * @param startMs - Start date epoch ms.
 * @param futureMonths - Extra months beyond today (default 0; callers
 *                      should pass getFutureMonths(options), typically 1).
 * @returns Array of DD/MM/YYYY billing month strings.
 */
function generateBillingMonths(startMs: number, futureMonths = 0): readonly string[] {
  const start = new Date(startMs);
  const firstMonth = new Date(start.getFullYear(), start.getMonth(), 1);
  const now = new Date();
  const endDate = new Date(now.getFullYear(), now.getMonth() + futureMonths, 1);
  const endMs = endDate.getTime();
  return buildMonthList(firstMonth, endMs, []);
}

/**
 * Format a single month entry as the canonical `01/MM/YYYY` cycle
 * label. Pulled out so {@link buildMonthList} stays a small
 * recursion driver.
 *
 * @param current - Date pointing at the first of the cycle's month.
 * @returns Stringified `01/MM/YYYY` entry.
 */
function formatBillingMonthEntry(current: Date): string {
  const rawMonth = current.getMonth() + 1;
  const monthStr = String(rawMonth).padStart(2, '0');
  const year = current.getFullYear();
  const yearStr = String(year);
  return `01/${monthStr}/${yearStr}`;
}

/**
 * Recursively build month list until current date.
 * @param current - Current month date.
 * @param endMs - End epoch ms.
 * @param accumulated - Months collected so far.
 * @returns Complete month list.
 */
function buildMonthList(current: Date, endMs: number, accumulated: string[]): readonly string[] {
  if (current.getTime() > endMs) return accumulated;
  const entry = formatBillingMonthEntry(current);
  const next = new Date(current.getFullYear(), current.getMonth() + 1, 1);
  return buildMonthList(next, endMs, [...accumulated, entry]);
}

export type { JsonNode };
export { bodyHasSignature, extractMatchingKeys, generateBillingMonths, objectKeysMatch };
