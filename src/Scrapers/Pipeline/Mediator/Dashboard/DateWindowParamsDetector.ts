/**
 * Phase H'' detector — picks the WK-aliased `[fromAlias, toAlias]`
 * URL-param-name tuple a bank uses for its txn date-window query.
 *
 * <p>Pure synchronous function: no I/O, no global state, deterministic.
 * Mirrors the SHAPE-driven pattern of {@link "./DedupKeyFieldsDetector"} —
 * walks the captured pool (URL search params + response body top-level
 * keys), matches against {@link WK.fromDate} / {@link WK.toDate} alias
 * arrays, emits the first observed pair when both sides are present.
 *
 * <p>Output contract:
 * <ul>
 *   <li>`['retrievalStartDate', 'retrievalEndDate']` for Hapoalim-style
 *     banks where the txn URL uses these WK aliases as query params.</li>
 *   <li>`['startDate', 'endDate']` for banks whose response body exposes
 *     the window as top-level field names.</li>
 *   <li>`[]` when no WK alias pair is observed.</li>
 * </ul>
 *
 * <p>Architectural pattern: same as Phase G `detectDedupKeyFields`
 * (user direction 2026-05-15). The detector emits a WK-aliased tuple;
 * SCRAPE consumes it to drive `applyDateRangeToUrl` window injection.
 * Zero bank-name knowledge.
 */

import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../Registry/WK/ScrapeWK.js';

/** Subset of a captured endpoint relevant to date-window probing. */
export interface IDateWindowProbeInput {
  readonly url: string;
  readonly responseBody: unknown;
}

/** Tuple emitted when no WK alias pair is observed. */
const EMPTY_TUPLE: readonly string[] = Object.freeze([]);

/**
 * Safe-parse a URL string, returning false on any failure so the
 * caller can fall through without try/catch noise.
 *
 * @param input - Captured URL.
 * @returns Parsed URL or false.
 */
function safeParseUrl(input: string): URL | false {
  try {
    return new URL(input);
  } catch {
    return false;
  }
}

/**
 * Reports the top-level keys of a captured response body wrapped in
 * an opaque {@link IDateWindowProbeInput.responseBody} field.
 *
 * @param probe - One captured pool entry whose body to inspect.
 * @returns Top-level key list of the body, or `[]` when not a plain object.
 */
function topLevelBodyKeys(probe: IDateWindowProbeInput): readonly string[] {
  const body = probe.responseBody;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return [];
  return Object.keys(body);
}

/**
 * Reports the first WK alias observed in one probe's URL search
 * params — the strongest signal because the bank actually sent the
 * alias as a query key.
 *
 * @param probe - One captured pool entry.
 * @param aliases - WK alias list.
 * @returns First matching alias or false.
 */
function findUrlAlias(probe: IDateWindowProbeInput, aliases: readonly string[]): string | false {
  const parsed = safeParseUrl(probe.url);
  if (parsed === false) return false;
  const hit = aliases.find((alias): boolean => parsed.searchParams.has(alias));
  return hit ?? false;
}

/**
 * Reports the first WK alias observed as a top-level body key — used
 * as the fallback signal when the URL didn't carry the alias as a
 * query param.
 *
 * @param probe - One captured pool entry.
 * @param aliases - WK alias list.
 * @returns First matching alias or false.
 */
function findBodyAlias(probe: IDateWindowProbeInput, aliases: readonly string[]): string | false {
  const keys = topLevelBodyKeys(probe);
  const hit = aliases.find((alias): boolean => keys.includes(alias));
  return hit ?? false;
}

/**
 * Reports the first WK alias observed in one probe — URL search
 * params first, top-level response body keys second.
 *
 * @param probe - One captured pool entry.
 * @param aliases - WK alias list.
 * @returns First matching alias or false.
 */
function findProbeAlias(probe: IDateWindowProbeInput, aliases: readonly string[]): string | false {
  const urlHit = findUrlAlias(probe, aliases);
  if (urlHit !== false) return urlHit;
  return findBodyAlias(probe, aliases);
}

/**
 * Reports the first WK alias observed across the whole captured pool.
 * First-match-wins across probes — earlier captures take precedence
 * over later ones.
 *
 * @param probes - Captured pool.
 * @param aliases - WK alias list.
 * @returns First matching alias or false.
 */
function findPoolAlias(
  probes: readonly IDateWindowProbeInput[],
  aliases: readonly string[],
): string | false {
  const hit = probes
    .map((probe): string | false => findProbeAlias(probe, aliases))
    .find((result): result is string => result !== false);
  return hit ?? false;
}

/**
 * Resolves the WK-aliased `[fromAlias, toAlias]` tuple a bank uses
 * for its txn date-window query. Scans every URL search param and
 * top-level response body key in the captured pool; emits the pair
 * only when both sides are observed.
 *
 * @param probes - Captured pool — pass an empty array to opt out.
 * @returns Non-empty `[fromAlias, toAlias]` tuple on match; `[]` otherwise.
 */
export default function detectDateWindowParams(
  probes: readonly IDateWindowProbeInput[],
): readonly string[] {
  if (probes.length === 0) return EMPTY_TUPLE;
  const fromAlias = findPoolAlias(probes, WK.fromDate);
  if (fromAlias === false) return EMPTY_TUPLE;
  const toAlias = findPoolAlias(probes, WK.toDate);
  if (toAlias === false) return EMPTY_TUPLE;
  return [fromAlias, toAlias];
}
