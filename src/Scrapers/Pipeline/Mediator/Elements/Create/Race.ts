/**
 * Race orchestration — runs Playwright locators through the hit-test
 * race, picks ONE canonical winner per DOM element (specificity-ranked),
 * and packages winners into IRaceResult.
 *
 * Public surface (consumed by parent CreateElementMediator's resolver
 * impls — `resolveVisibleImpl`, `resolveVisibleNthAware`,
 * `resolveAllVisibleImpl`):
 *
 *   - `raceEntriesToResult` — race entries through hit-test, return the
 *     found-result for the winner or NOT_FOUND_RESULT.
 *   - `traceRaceDiagnostic` — debug-level log emitter for race outcomes
 *     (winner index + per-locator detail), shared by every race caller.
 *   - `setupAllVisibleRace` — prepare race inputs (nth-expanded entries +
 *     locator array + capped timeout) for the multi-winner path.
 *   - `extractWinnerSequence` — turn race-winner indices into IRaceResults
 *     with DOM-element dedup + selector-specificity ranking + cap.
 *   - `IRaceSetup` — return shape of `setupAllVisibleRace`.
 *
 * All other helpers (per-winner identity enrichment, group dedup,
 * specificity ranking, diagnostic line formatting) stay private — they
 * have no callers outside this cluster.
 *
 * Extracted from CreateElementMediator.ts (Phase 12a §6).
 */

import type { Locator, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../Base/Config/LoginConfigTypes.js';
import { capTimeout, getDebug } from '../../../Types/Debug.js';
import { type IElementIdentity, type IRaceResult, NOT_FOUND_RESULT } from '../ElementMediator.js';
import { buildLocatorEntriesAll, type ILocatorEntry } from './Entries.js';
import { type IRaceDiagnostic, raceLocatorsFirstHit } from './Hittest.js';
import { buildFoundResult, extractAndTraceIdentity, snapshotValue } from './Snapshot.js';

const LOG = getDebug(import.meta.url);

/**
 * Format a single locator detail line for race diagnostic.
 * @param entries - All entries array.
 * @param idx - Index of the fulfilled entry to format.
 * @returns Formatted "kind:value @ url" string.
 */
function formatLocatorDetail(entries: readonly ILocatorEntry[], idx: number): string {
  const e = entries[idx];
  return `${e.candidate.kind}:${e.candidate.value} @ ${e.context.url()}`;
}

/**
 * Log race diagnostic — fulfilled count + winner index + per-locator detail.
 * Emitted at debug level (not trace) so the resolver flow stays visible at
 * the standard CI debug level. Without this, debug-level runs see the
 * "resolveVisible: 49 locators" probe but no winner — i.e. blind to which
 * locator actually matched.
 * @param entries - All locator entries with candidate + context.
 * @param diag - Race diagnostic result.
 * @returns True after logging.
 */
export function traceRaceDiagnostic(
  entries: readonly ILocatorEntry[],
  diag: IRaceDiagnostic,
): true {
  const detail = diag.fulfilledIndices.map((idx): string => formatLocatorDetail(entries, idx));
  LOG.debug({
    fulfilled: diag.fulfilledCount,
    hitTestPassed: diag.hitTestPassedCount,
    winner: diag.winner,
    detail,
  });
  return true;
}

/**
 * Run the hit-test race against an entry list, log diagnostics.
 * Extracted so resolveVisibleImpl + resolveVisibleNthAware share one path.
 * @param entries - Locator entries (single-match `.first()` OR nth-enumerated).
 * @param timeout - Race timeout (already capped by caller).
 * @param label - Log prefix identifying the resolver (for diagnostic trace).
 * @returns Race diagnostic with winner + fulfilled detail.
 */
async function runHitTestRace(
  entries: readonly ILocatorEntry[],
  timeout: number,
  label: string,
): Promise<IRaceDiagnostic> {
  const locators = entries.map((e): Locator => e.locator);
  const countStr = String(locators.length);
  const timeoutStr = String(timeout);
  LOG.debug({ message: `${label}: ${countStr} locators, timeout=${timeoutStr}ms` });
  const diag = await raceLocatorsFirstHit(locators, timeout);
  traceRaceDiagnostic(entries, diag);
  return diag;
}

/**
 * Capture identity + value from the winning entry and wrap as IRaceResult.
 * Shared by all race callers (single-winner `raceEntriesToResult` and
 * single-frame `resolveVisibleInContextImpl` / `tryAttachedClickFallback`).
 * @param winner - Winning locator entry.
 * @param index - Winner's index within the entries array.
 * @returns Found IRaceResult ready for the caller.
 */
export async function enrichWinnerToResult(
  winner: ILocatorEntry,
  index: number,
): Promise<IRaceResult> {
  const identity = await extractAndTraceIdentity(winner);
  const value = await snapshotValue(winner);
  return buildFoundResult(winner, { index, value, identity });
}

/**
 * Race entries through hit-test, return found-result or NOT_FOUND.
 * Shared body for resolveVisibleImpl (`.first()` per candidate) and
 * resolveVisibleNthAware (nth-enumerated). Caller picks the entry-builder.
 * @param entries - Locator entries to race.
 * @param timeout - Race timeout (already capped).
 * @param label - Diagnostic label for log output.
 * @returns Found-result on hit-test winner, NOT_FOUND_RESULT otherwise.
 */
export async function raceEntriesToResult(
  entries: readonly ILocatorEntry[],
  timeout: number,
  label: string,
): Promise<IRaceResult> {
  if (entries.length === 0) return NOT_FOUND_RESULT;
  const diag = await runHitTestRace(entries, timeout, label);
  if (diag.winner < 0) return NOT_FOUND_RESULT;
  return enrichWinnerToResult(entries[diag.winner], diag.winner);
}

/**
 * Serialize an element identity into a deterministic, '|'-joined string
 * key for set-based dedup. Frame URL leads the tuple so cross-iframe
 * collisions cannot occur when downstream callers use the same identity
 * fields. Extracted from {@link buildDedupKey} to keep that function
 * within the 10-LoC cap.
 * @param frameUrl - URL of the locator entry's owning frame.
 * @param identity - DOM identity captured by `extractAndTraceIdentity`.
 * @returns Deterministic `'|'`-joined identity tuple.
 */
function serializeIdentity(frameUrl: string, identity: IElementIdentity): string {
  return [
    frameUrl,
    identity.tag,
    identity.classes,
    identity.name,
    identity.type,
    identity.ariaLabel,
    identity.title,
    identity.href,
  ].join('|');
}

/**
 * Build a dedup key for a winning element. Both branches incorporate the
 * frame URL so two distinct iframes with the same DOM id do NOT collapse
 * into a single dedup group (cross-iframe collision protection). When the
 * resolved element has no DOM id, the fallback concatenates the full
 * identity tuple (tag/classes/name/type/ariaLabel/title/href) instead of
 * the selector that found it — so two distinct elements in the same frame
 * that happen to match the same selector also do NOT collapse into one.
 *
 * Prior shape used `id:${identity.id}` without frame context which merged
 * same-id elements across iframes, and a `kind=value@frameUrl` fallback
 * which merged distinct elements that the same WK selector pointed at.
 *
 * @param entry - The fulfilling locator entry (carries candidate + frame).
 * @param identity - DOM identity captured by `extractAndTraceIdentity`.
 * @returns A string key safe to insert into a Set for dedup.
 */
function buildDedupKey(entry: ILocatorEntry, identity: IElementIdentity): string {
  const frameUrl = entry.context.url();
  if (identity.id !== '(none)' && identity.id.length > 0) {
    return `id:${frameUrl}:${identity.id}`;
  }
  return serializeIdentity(frameUrl, identity);
}

/**
 * Bundled args for `extractWinnerSequence` — keeps the signature inside the
 * 3-param ceiling.
 */
interface ISequenceArgs {
  readonly entries: readonly ILocatorEntry[];
  readonly indices: readonly number[];
  readonly cap: number;
}

/** Race winner enriched with identity + dedup key + selector specificity. */
interface IEnrichedWinner {
  readonly winnerIdx: number;
  readonly entry: ILocatorEntry;
  readonly identity: IElementIdentity;
  readonly key: string;
  readonly rank: number;
}

/** Selector specificity by candidate kind. Lower = more specific. */
const KIND_SPECIFICITY: Readonly<Record<SelectorCandidate['kind'], number>> = {
  name: 2,
  ariaLabel: 4,
  css: 5,
  xpath: 6,
  placeholder: 7,
  labelText: 8,
  exactText: 9,
  clickableText: 10,
  textContent: 11,
  regex: 12,
};

/** CSS attribute-prefix specificity (overrides bare 'css' kind). */
const CSS_PREFIX_SPECIFICITY: readonly (readonly [string, number])[] = [
  ['[id=', 0],
  ['[name=', 1],
  ['[aria-label=', 3],
];

/**
 * CSS-specific specificity for the value-prefix overrides. Returns -1 when
 * the candidate isn't a CSS selector matching one of the special prefixes;
 * the caller falls back to KIND_SPECIFICITY.
 * @param candidate - The selector candidate to inspect.
 * @returns Specificity rank, or -1 when no CSS prefix override applies.
 */
function cssPrefixRank(candidate: SelectorCandidate): number {
  if (candidate.kind !== 'css') return -1;
  const matched = CSS_PREFIX_SPECIFICITY.find(([prefix]) => candidate.value.startsWith(prefix));
  if (!matched) return -1;
  return matched[1];
}

/**
 * Compute a specificity rank for a SelectorCandidate. CSS selectors that
 * lock onto `[id=]`, `[name=]`, or `[aria-label=]` rank above generic CSS;
 * text-based kinds rank lowest. Used to pick the most specific selector
 * within a group of race winners that all resolved to the same DOM element.
 * @param candidate - The selector candidate to rank.
 * @returns Lower number = more specific.
 */
function candidateSpecificityRank(candidate: SelectorCandidate): number {
  const cssRank = cssPrefixRank(candidate);
  if (cssRank >= 0) return cssRank;
  return KIND_SPECIFICITY[candidate.kind];
}

/**
 * Enrich one race-winner index with its identity + dedup key + specificity
 * rank. Extracted so `enrichAllWinners` stays inside the line-count ceiling.
 * @param entries - The full locator-entry array.
 * @param winnerIdx - Index into `entries` for this race winner.
 * @returns Enriched winner record.
 */
async function enrichWinner(
  entries: readonly ILocatorEntry[],
  winnerIdx: number,
): Promise<IEnrichedWinner> {
  const entry = entries[winnerIdx];
  const identity = await extractAndTraceIdentity(entry);
  const key = buildDedupKey(entry, identity);
  const rank = candidateSpecificityRank(entry.candidate);
  return { winnerIdx, entry, identity, key, rank };
}

/**
 * Enrich all race winners in parallel — each gets its DOM identity + dedup
 * key + selector specificity rank.
 * @param args - Locator entries, race-winner indices, cap.
 * @returns Enriched winners, in race-time order.
 */
async function enrichAllWinners(args: ISequenceArgs): Promise<readonly IEnrichedWinner[]> {
  const promises = args.indices.map(idx => enrichWinner(args.entries, idx));
  return Promise.all(promises);
}

/**
 * Decide whether `candidate` should replace the current group representative.
 * @param existing - Current canonical entry for the group (or `false` if none).
 * @param candidate - New entry being considered.
 * @returns True when the candidate is more specific than the existing entry.
 */
function shouldReplaceGroupCanonical(
  existing: IEnrichedWinner | false,
  candidate: IEnrichedWinner,
): boolean {
  if (!existing) return true;
  return candidate.rank < existing.rank;
}

/**
 * Insert one enriched winner into the group map, replacing any existing
 * entry only when the candidate has higher specificity. Extracted so the
 * caller's loop body stays inside the depth-1 ceiling.
 * @param groups - Mutable group map keyed by buildDedupKey.
 * @param candidate - Enriched winner being considered for canonical slot.
 * @returns True after the insert/replace decision is recorded.
 */
function upsertCanonicalGroup(
  groups: Map<string, IEnrichedWinner>,
  candidate: IEnrichedWinner,
): true {
  const existing = groups.get(candidate.key) ?? false;
  const isUpgrade = shouldReplaceGroupCanonical(existing, candidate);
  if (isUpgrade) groups.set(candidate.key, candidate);
  return true;
}

/**
 * Group enriched winners by dedup key, keeping ONE canonical entry per
 * group (the one with the most specific selector). Insertion order
 * preserves race-time order of FIRST encounter for each DOM element.
 * @param enriched - All race winners, identity-tagged.
 * @returns One canonical entry per distinct DOM element.
 */
function pickCanonicalPerGroup(enriched: readonly IEnrichedWinner[]): readonly IEnrichedWinner[] {
  const groups = new Map<string, IEnrichedWinner>();
  for (const e of enriched) upsertCanonicalGroup(groups, e);
  return [...groups.values()];
}

/**
 * Build the final IRaceResult for one canonical winner — snapshots the
 * value at click-time and wraps the entry + identity into a found-result.
 * @param e - Canonical enriched winner for a DOM-element group.
 * @returns IRaceResult ready for the caller.
 */
async function buildResultFromEnriched(e: IEnrichedWinner): Promise<IRaceResult> {
  const value = await snapshotValue(e.entry);
  return buildFoundResult(e.entry, { index: e.winnerIdx, value, identity: e.identity });
}

/**
 * Emit one IRaceResult per DISTINCT DOM element — never multiple results
 * for the same element via different selectors. Algorithm:
 *   1. Enrich every race winner with identity + dedup key + specificity
 *   2. Group by dedup key, pick the most-specific selector per group
 *   3. Cap at `args.cap` GROUPS (i.e. distinct DOM elements)
 *   4. Build IRaceResult per surviving canonical winner
 * Replaces the old race-time-order walk that biased toward selector kind
 * over DOM-element distinctness.
 * @param args - Locator entries, race-winner indices, cap.
 * @returns Up to `cap` IRaceResult entries, one per distinct DOM element.
 */
export async function extractWinnerSequence(args: ISequenceArgs): Promise<IRaceResult[]> {
  const enriched = await enrichAllWinners(args);
  const canonical = pickCanonicalPerGroup(enriched);
  const capped = canonical.slice(0, args.cap);
  const resultPromises = capped.map(buildResultFromEnriched);
  return Promise.all(resultPromises);
}

/** Bundle returned by `setupAllVisibleRace` (race inputs in one Pick). */
export interface IRaceSetup {
  readonly entries: readonly ILocatorEntry[];
  readonly locators: Locator[];
  readonly timeout: number;
}

/**
 * Prepare race inputs: build all locator entries (with nth-enumeration),
 * extract their locators, and cap the timeout.
 * @param page - Playwright page.
 * @param candidates - WK selector candidates.
 * @param timeout - Caller-provided timeout (capped before return).
 * @returns Bundle ready for raceLocatorsWithHitTest.
 */
export async function setupAllVisibleRace(
  page: Page,
  candidates: readonly SelectorCandidate[],
  timeout: number,
): Promise<IRaceSetup> {
  const entries = await buildLocatorEntriesAll(page, candidates);
  const locators = entries.map((e): Locator => e.locator);
  return { entries, locators, timeout: capTimeout(timeout) };
}
