/**
 * Locator-entry assembly. Each `ILocatorEntry` pairs a Playwright
 * Locator with the candidate descriptor and browsing-context that
 * produced it — every downstream race / hit-test trace pivots off that
 * triple. Public surface:
 *   - `ILocatorEntry` — the candidate + context + locator carrier used
 *     by every resolver and the race plumbing.
 *   - `buildLocatorEntries` — single-shot expansion (`.first()`
 *     semantics) used by `resolveVisible` and similar single-winner
 *     resolvers.
 *   - `buildLocatorEntriesAll` — multi-match expansion
 *     (`.nth(0..MAX_NTH_PER_LOCATOR-1)`) used by `resolveAllVisible` /
 *     `resolveAndClick` so legacy + modern sibling pairs enter the
 *     race.
 *
 * `MAX_NTH_PER_LOCATOR`, `getAllContexts`, and the per-expansion
 * helpers stay private — their only call-sites live here, and keeping
 * them encapsulated narrows the cluster's reach when the parent module
 * is finally trimmed in Phase 12a §6.
 *
 * Extracted from CreateElementMediator.ts (Phase 12a §4) so the god
 * module no longer owns context-fanout + nth-expansion.
 */

import type { Frame, Locator, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../Base/Config/LoginConfigTypes.js';
import { buildCandidateLocators, buildCandidateLocatorsBase } from './Locators.js';
import { NO_FORM_ANCHOR } from './Scope.js';

/**
 * Collect all contexts to search: main page + child iframes.
 * @param page - The Playwright page.
 * @returns Array of Page/Frame contexts to build locators from.
 */
function getAllContexts(page: Page): (Page | Frame)[] {
  const mainFrame = page.mainFrame();
  const childFrames = page.frames().filter((f): boolean => f !== mainFrame);
  return [page, ...childFrames];
}

/** A locator paired with the candidate and context that produced it. */
export interface ILocatorEntry {
  readonly locator: Locator;
  readonly candidate: SelectorCandidate;
  readonly context: Page | Frame;
}

/**
 * Build a single `ILocatorEntry` array for one (context, candidate)
 * pair. Extracted from `buildLocatorEntries` so the public entry stays
 * a thin context-fanout composition.
 * @param ctx - Page or Frame producing the locators.
 * @param candidate - WellKnown selector candidate.
 * @param formAnchor - CSS form selector (or NO_FORM_ANCHOR).
 * @returns Locator entries (one per base locator produced by `buildCandidateLocators`).
 */
function entriesForCandidate(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
  formAnchor: string,
): ILocatorEntry[] {
  return buildCandidateLocators(ctx, candidate, formAnchor).map(
    (locator): ILocatorEntry => ({ locator, candidate, context: ctx }),
  );
}

/**
 * Build locator entries with metadata for all contexts × candidates.
 * Preserves which candidate and context produced each locator.
 * @param page - The Playwright page.
 * @param candidates - WellKnown selector candidates.
 * @param formAnchor - Optional CSS form selector for descendant scoping
 *   applied uniformly to every candidate kind via Locator chaining.
 * @returns Array of locator entries with metadata.
 */
export function buildLocatorEntries(
  page: Page,
  candidates: readonly SelectorCandidate[],
  formAnchor = NO_FORM_ANCHOR,
): ILocatorEntry[] {
  const contexts = getAllContexts(page);
  return contexts.flatMap((ctx): ILocatorEntry[] =>
    candidates.flatMap((c): ILocatorEntry[] => entriesForCandidate(ctx, c, formAnchor)),
  );
}

/** Maximum nth-matches enumerated per locator in `resolveAllVisible` —
 *  surfaces multi-element matches (legacy + modern nav buttons) into the
 *  candidate list without exploding the race work. */
const MAX_NTH_PER_LOCATOR = 5;

/**
 * Expand a single locator into up to N nth-locators, one per matching DOM
 * element. Uses `locator.count()` to discover how many siblings match,
 * caps at `max`. Used by `resolveAllVisible` to surface legacy/modern
 * sibling pairs (same aria-label, distinct ids) so identity-dedup can
 * collapse race winners that point to the same element while preserving
 * distinct ones.
 * @param base - Base locator (without `.first()`).
 * @param max - Cap on returned nth-locators.
 * @returns Up to `max` `.nth(i)` locators (empty when count() rejects or 0).
 */
async function expandLocatorToNth(base: Locator, max: number): Promise<readonly Locator[]> {
  const total = await base.count().catch((): number => 0);
  if (total <= 0) return [];
  const limit = Math.min(total, max);
  return Array.from({ length: limit }, (_v, i): Locator => base.nth(i));
}

/**
 * Bundled args for the per-candidate locator-entry expander — keeps the
 * helper inside the 3-param ceiling.
 */
interface IExpandEntryArgs {
  readonly ctx: Page | Frame;
  readonly candidate: SelectorCandidate;
  readonly maxPerLocator: number;
  readonly formAnchor: string;
}

/**
 * Flatten expanded locators into `ILocatorEntry` records.
 * @param expanded - Per-base expansion of locator nth-matches.
 * @param candidate - The candidate that produced these locators.
 * @param ctx - Page or Frame they belong to.
 * @returns Locator entries (locator + candidate + context).
 */
function entriesFromExpansion(
  expanded: readonly (readonly Locator[])[],
  candidate: SelectorCandidate,
  ctx: Page | Frame,
): readonly ILocatorEntry[] {
  return expanded.flatMap((locs): readonly ILocatorEntry[] =>
    locs.map((locator): ILocatorEntry => ({ locator, candidate, context: ctx })),
  );
}

/**
 * Build locator entries that may surface multiple nth-matches per base
 * locator. Used by resolveAllVisible / multi-match resolvers.
 * @param args - Bundled context + candidate + per-locator cap + formAnchor.
 * @returns Locator entries (one per nth-match per base locator).
 */
async function expandCandidateEntries(args: IExpandEntryArgs): Promise<readonly ILocatorEntry[]> {
  const bases = buildCandidateLocatorsBase(args.ctx, args.candidate, args.formAnchor);
  const expansionPromises = bases.map(
    (b): Promise<readonly Locator[]> => expandLocatorToNth(b, args.maxPerLocator),
  );
  const expanded = await Promise.all(expansionPromises);
  return entriesFromExpansion(expanded, args.candidate, args.ctx);
}

/**
 * Build locator entries that surface MULTIPLE elements per locator (up to
 * `MAX_NTH_PER_LOCATOR`). Used only by `resolveAllVisible` so other
 * resolvers (login/preLogin/etc.) keep their `.first()`-only semantics —
 * zero behavioural change for banks that already pass on attempt 0.
 * @param page - Playwright page.
 * @param candidates - WK selector candidates.
 * @param formAnchor - Optional CSS form selector — when set, all candidate
 *   kinds are scoped to descendants of the form via Locator chaining.
 * @returns Locator entries (contexts × candidates × nth-matches).
 */
export async function buildLocatorEntriesAll(
  page: Page,
  candidates: readonly SelectorCandidate[],
  formAnchor = NO_FORM_ANCHOR,
): Promise<readonly ILocatorEntry[]> {
  const promises = collectExpansionPromises(page, candidates, formAnchor);
  const groups = await Promise.all(promises);
  return groups.flat();
}

/**
 * Walk all contexts and gather per-(ctx,candidate) expansion promises in
 * a single flat array. Extracted from `buildLocatorEntriesAll` so the
 * parent's body fits inside the 10-LoC cap.
 * @param page - Playwright page.
 * @param candidates - WK selector candidates.
 * @param formAnchor - Optional CSS form selector for descendant scoping.
 * @returns Flat array of per-(ctx,candidate) expansion promises.
 */
function collectExpansionPromises(
  page: Page,
  candidates: readonly SelectorCandidate[],
  formAnchor: string,
): Promise<readonly ILocatorEntry[]>[] {
  return getAllContexts(page).flatMap((ctx): Promise<readonly ILocatorEntry[]>[] =>
    mapCandidatesToExpansions(ctx, candidates, formAnchor),
  );
}

/**
 * Build the per-(ctx,candidate) expansion promises array. Extracted from
 * `buildLocatorEntriesAll` so the parent function's nesting stays inside
 * the depth-1 ceiling.
 * @param ctx - Playwright context (Page or Frame).
 * @param candidates - WK selector candidates to enumerate per locator.
 * @param formAnchor - Optional CSS form selector for descendant scoping.
 * @returns One promise of locator entries per candidate, in input order.
 */
function mapCandidatesToExpansions(
  ctx: Page | Frame,
  candidates: readonly SelectorCandidate[],
  formAnchor = NO_FORM_ANCHOR,
): Promise<readonly ILocatorEntry[]>[] {
  return candidates.map(
    (c): Promise<readonly ILocatorEntry[]> => expandOneCandidate(ctx, c, formAnchor),
  );
}

/**
 * Run `expandCandidateEntries` for a single (ctx,candidate) pair.
 * Extracted so {@link mapCandidatesToExpansions} stays inside the 10-LoC
 * cap without resorting to a nested arrow that the function-jsdoc gate
 * would flag.
 * @param ctx - Playwright context (Page or Frame).
 * @param candidate - Single WK selector candidate to enumerate.
 * @param formAnchor - Optional CSS form selector for descendant scoping.
 * @returns Promise of locator entries for this candidate.
 */
function expandOneCandidate(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
  formAnchor: string,
): Promise<readonly ILocatorEntry[]> {
  return expandCandidateEntries({ ctx, candidate, maxPerLocator: MAX_NTH_PER_LOCATOR, formAnchor });
}
