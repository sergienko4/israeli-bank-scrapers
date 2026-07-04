/**
 * Resolve cluster — visible-element race surfaces and the form-anchor
 * cluster builder. Owns the four resolveVisible* methods plus the
 * resolveAndClick / getFormAnchor wiring so the façade in
 * CreateElementMediator.ts can flatten to a tiny `assemble` spread.
 *
 * Why these live together:
 *   - All five locator-race methods share the same `IClickResolveArgs` /
 *     `IResolveAllArgs` argument shapes and identical hit-test +
 *     trace-diagnostic plumbing.
 *   - The form-anchor cluster (`buildFormCluster`) reads from the same
 *     `IFormCache` that gets passed into `resolveAndClick` callers, so
 *     keeping them adjacent makes the cohesion visible.
 */

import type { Frame, Locator, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../Base/Config/LoginConfigTypes.js';
import { WK_LOGIN_FORM } from '../../../Registry/WK/LoginWK.js';
import { capTimeout, getDebug } from '../../../Types/Debug.js';
import { isSome, none, type Option, some } from '../../../Types/Option.js';
import { type Procedure, succeed } from '../../../Types/Procedure.js';
import { type IElementMediator, type IRaceResult, NOT_FOUND_RESULT } from '../ElementMediator.js';
import { buildDiscoverForm, buildScopeToForm } from './Discover.js';
import { buildLocatorEntries, buildLocatorEntriesAll, type ILocatorEntry } from './Entries.js';
import { buildResolveClickable, buildResolveField, type IFormCache } from './FieldResolve.js';
import { type IRaceDiagnostic, raceLocators, raceLocatorsWithHitTest } from './Hittest.js';
import { buildCandidateLocators } from './Locators.js';
import {
  enrichWinnerToResult,
  extractWinnerSequence,
  raceEntriesToResult,
  setupAllVisibleRace,
  traceRaceDiagnostic,
} from './Race.js';
import { CLICK_RACE_TIMEOUT, NO_FORM_ANCHOR } from './Scope.js';

const LOG = getDebug(import.meta.url);

/**
 * Bundled args for the click-resolution pipeline (resolveVisibleNthAware
 * and resolveAndClickImpl). Keeps both functions inside the 3-param
 * ceiling while threading formAnchor for form-membership scoping.
 */
interface IClickResolveArgs {
  readonly page: Page;
  readonly candidates: readonly SelectorCandidate[];
  readonly timeout: number;
  readonly formAnchor: string;
}

/** Bundled args for `resolveAllVisibleImpl` — 3-param ceiling. */
interface IResolveAllArgs {
  readonly page: Page;
  readonly candidates: readonly SelectorCandidate[];
  readonly timeout: number;
  readonly cap: number;
}

/**
 * Resolve the first visible element — parallel race across candidates with
 * `.first()` per locator. Uses the SAME resolveVisible + hit-test logic in
 * both LIVE and MOCK modes (Rule #20: passive discovery is identical). If
 * an element isn't visible in the rendered snapshot, the mock MUST fail —
 * that's the whole point. When `args.formAnchor` is set, ALL candidate kinds
 * are scoped to descendants of the form via Playwright Locator chaining.
 * @param args - Bundled page + candidates + timeout + formAnchor.
 * @returns Race result with locator + metadata, or NOT_FOUND.
 */
async function resolveVisibleImpl(args: IClickResolveArgs): Promise<IRaceResult> {
  const entries = buildLocatorEntries(args.page, args.candidates, args.formAnchor);
  const effectiveTimeout = capTimeout(args.timeout);
  return raceEntriesToResult(entries, effectiveTimeout, 'resolveVisible');
}

/**
 * Resolve the first visible element — like resolveVisibleImpl but enumerates
 * `.nth(0..MAX_NTH_PER_LOCATOR-1)` per base locator so multi-match elements
 * (e.g. several `<button type="submit">` across login + SMS forms) all enter
 * the race. Hit-test picks the truly visible+enabled winner.
 *
 * When `args.formAnchor` is set, ALL candidate kinds are scoped to descendants
 * of the form via Playwright Locator chaining — `ctx.locator(formAnchor)`
 * becomes the parent context for `.locator/.getByText/.getByLabel/...`,
 * and absolute "//xpath" is relativized to ".//xpath". Form-membership is
 * a deterministic DOM-tree filter, independent of CSS visibility timing.
 *
 * @param args - Bundled page + candidates + timeout + formAnchor.
 * @returns Race result with locator + metadata, or NOT_FOUND.
 */
async function resolveVisibleNthAware(args: IClickResolveArgs): Promise<IRaceResult> {
  const entries = await buildLocatorEntriesAll(args.page, args.candidates, args.formAnchor);
  const effectiveTimeout = capTimeout(args.timeout);
  return raceEntriesToResult(entries, effectiveTimeout, 'resolveVisibleNthAware');
}

/**
 * Run the hit-test race + diagnostic + winner-sequence phase for
 * `resolveAllVisibleImpl`. Extracted so the orchestrator stays within
 * the 10-LoC cap; matches the `runHitTestRaceLike` extraction for the
 * single-visible variant.
 * @param setup - Pre-built race setup (entries + locators + timeout).
 * @param cap - Maximum winner entries to return.
 * @returns Up to `cap` race-result entries; empty when none fulfill.
 */
async function runAllVisibleRace(
  setup: Awaited<ReturnType<typeof setupAllVisibleRace>>,
  cap: number,
): Promise<readonly IRaceResult[]> {
  const probeLabel = `resolveAllVisible (cap=${String(cap)})`;
  logResolveProbe(probeLabel, setup.locators.length, setup.timeout);
  const diag = await raceLocatorsWithHitTest(setup.locators, setup.timeout);
  traceRaceDiagnostic(setup.entries, diag);
  if (diag.fulfilledIndices.length === 0) return [];
  return extractWinnerSequence({ entries: setup.entries, indices: diag.fulfilledIndices, cap });
}

/**
 * Resolve all visible elements matching any of the candidate selectors —
 * enumerates `.nth(0..MAX_NTH_PER_LOCATOR-1)` per base locator so multi-match
 * elements (legacy + modern nav buttons sharing the same aria-label) BOTH
 * surface in the candidate list. Identity dedup (`extractWinnerSequence`)
 * collapses race winners that point to the same DOM element.
 * @param args - Bundled page + candidates + timeout + cap.
 * @returns Up to `args.cap` race-result entries; empty when none fulfill.
 */
async function resolveAllVisibleImpl(args: IResolveAllArgs): Promise<readonly IRaceResult[]> {
  if (args.cap < 1) return [];
  const setup = await setupAllVisibleRace(args.page, args.candidates, args.timeout);
  if (setup.entries.length === 0) return [];
  return runAllVisibleRace(setup, args.cap);
}

/**
 * Build IRaceResult entries from a list of WK selector candidates within a
 * SINGLE Page or Frame context. Each candidate may produce multiple base
 * locators; the result list pairs every locator with its source candidate
 * and the context it was bound to.
 * @param ctx - The Playwright Page or Frame to resolve against.
 * @param candidates - WellKnown selector candidates to expand.
 * @returns Flat list of ILocatorEntry — one per base locator.
 */
function buildContextEntries(
  ctx: Page | Frame,
  candidates: readonly SelectorCandidate[],
): readonly ILocatorEntry[] {
  return candidates.flatMap((c): ILocatorEntry[] =>
    buildCandidateLocators(ctx, c).map((locator): ILocatorEntry => ({
      locator,
      candidate: c,
      context: ctx,
    })),
  );
}

/**
 * Emit a structured "N locators racing with Tms budget" debug log used by
 * every resolveImpl variant so log output is uniform.
 * @param label - Label naming the caller (e.g. `resolveVisibleInContext`).
 * @param count - Locator count.
 * @param timeoutMs - Effective race timeout (post-capTimeout).
 * @returns Sentinel `true` once the log has been emitted.
 */
function logResolveProbe(label: string, count: number, timeoutMs: number): true {
  LOG.debug({ message: `${label}: ${String(count)} locators, ${String(timeoutMs)}ms` });
  return true;
}

/**
 * Run the hit-test race against a pre-built entry list. Encapsulates
 * the cap-timeout + probe log + hit-test race + diagnostic trace
 * sequence shared by `resolveVisibleInContextImpl` (and other
 * single-context resolvers) so the parent body stays at the
 * "build entries → race → translate winner" rhythm.
 * @param label - Caller label for the probe log line.
 * @param entries - Locator entries (one Locator per entry).
 * @param timeout - Per-locator race timeout in ms (pre-capTimeout).
 * @returns Race diagnostic with winner + fulfilled indices.
 */
async function runHitTestRaceLike(
  label: string,
  entries: readonly ILocatorEntry[],
  timeout: number,
): Promise<IRaceDiagnostic> {
  const locators = entries.map((e): Locator => e.locator);
  const effectiveTimeout = capTimeout(timeout);
  logResolveProbe(label, locators.length, effectiveTimeout);
  const diag = await raceLocatorsWithHitTest(locators, effectiveTimeout);
  traceRaceDiagnostic(entries, diag);
  return diag;
}

/**
 * Resolve the first visible element within a SINGLE frame context.
 * Same logic as resolveVisibleImpl but scoped to one context.
 * @param ctx - The specific Page or Frame to search.
 * @param candidates - WellKnown selector candidates.
 * @param timeout - Race timeout in ms.
 * @returns IRaceResult scoped to the given context.
 */
async function resolveVisibleInContextImpl(
  ctx: Page | Frame,
  candidates: readonly SelectorCandidate[],
  timeout: number,
): Promise<IRaceResult> {
  const entries = buildContextEntries(ctx, candidates);
  if (entries.length === 0) return NOT_FOUND_RESULT;
  const diag = await runHitTestRaceLike('resolveVisibleInContext', entries, timeout);
  if (diag.winner < 0) return NOT_FOUND_RESULT;
  return enrichWinnerToResult(entries[diag.winner], diag.winner);
}

/**
 * Force-click the winner of an attached race. Returns whether the click
 * actually fired — the caller propagates NOT_FOUND_RESULT on failure
 * instead of silently claiming success. Extracted so the parent body
 * stays ≤10 LoC while keeping the click-outcome check explicit.
 * @param locator - Winner locator from the attached race.
 * @param timeoutMs - Force-click timeout in milliseconds.
 * @returns True when the click resolved without throwing.
 */
async function tryForceClick(locator: Locator, timeoutMs: number): Promise<boolean> {
  return locator
    .click({ force: true, timeout: timeoutMs })
    .then((): true => true)
    .catch((): false => false);
}

/**
 * Fallback path for resolveAndClickImpl when no element passed the
 * "visible" hit-test race: try a force-click against the FIRST attached
 * candidate. Extracted so the parent body stays ≤10 LoC.
 * @param args - Bundled page + candidates + formAnchor.
 * @param effectiveTimeout - Already-capped race timeout (ms).
 * @returns Procedure wrapping the attached IRaceResult (or NOT_FOUND).
 */
async function tryAttachedClickFallback(
  args: IClickResolveArgs,
  effectiveTimeout: number,
): Promise<Procedure<IRaceResult>> {
  const entries = buildLocatorEntries(args.page, args.candidates, args.formAnchor);
  const locators = entries.map((e): Locator => e.locator);
  const winnerIdx = await raceLocators(locators, effectiveTimeout, 'attached');
  if (winnerIdx < 0) return succeed(NOT_FOUND_RESULT);
  const didClick = await tryForceClick(entries[winnerIdx].locator, effectiveTimeout);
  if (!didClick) return succeed(NOT_FOUND_RESULT);
  return succeed(await enrichWinnerToResult(entries[winnerIdx], winnerIdx));
}

/**
 * Try a non-force click on the visible-race winner. Returns whether the
 * click actually fired — the caller falls through to the attached-force
 * fallback when this is false instead of silently claiming success.
 * Extracted so the parent body stays ≤10 LoC while keeping the
 * click-outcome check explicit.
 * @param locator - Winner locator from the visible hit-test race.
 * @param timeoutMs - Click timeout in milliseconds (already capped).
 * @returns True when the click resolved without throwing.
 */
async function tryVisibleClick(locator: Locator, timeoutMs: number): Promise<boolean> {
  return locator
    .click({ timeout: timeoutMs })
    .then((): true => true)
    .catch((): false => false);
}

/**
 * Try the visible-race click path: pick the winning locator, run a
 * non-force click, and wrap the success as `succeed(result)`. Returns
 * `none()` when either the visible race produced no winner or the winner
 * failed to click — the caller then falls through to the attached-force
 * fallback instead of silently claiming success.
 *
 * Extracted so {@link resolveAndClickImpl} flattens to a single
 * sequential composition (`race → maybe visible → attached fallback`)
 * and the max-depth ceiling stays honored. Uses `Option<Procedure<…>>`
 * instead of nullable returns per the no-nullable-returns architecture
 * rule.
 * @param result - Winner of the visible hit-test race (may be NOT_FOUND).
 * @param effectiveTimeout - Already-capped click timeout (ms).
 * @returns `some(succeed(result))` on visible-click success, `none()` otherwise.
 */
async function tryVisibleClickPath(
  result: IRaceResult,
  effectiveTimeout: number,
): Promise<Option<Procedure<IRaceResult>>> {
  if (!result.found || !result.locator) return none();
  const didClick = await tryVisibleClick(result.locator, effectiveTimeout);
  if (!didClick) return none();
  const successProc = succeed(result);
  return some(successProc);
}

/**
 * Resolve and click — tries visible elements first; falls back to attached (force click)
 * when either the visible-race finds no winner OR the visible winner fails to click
 * (the previous shape silently returned succeed(result) when click() rejected, masking
 * a missed-click as success and skipping the attached-force fallback that exists
 * precisely for that case).
 *
 * Fallback handles elements hidden by accessibility overlays (e.g. UserWay) that are
 * in the DOM but have zero bounding box or are offset off-screen.
 * When `args.formAnchor` is set, ALL candidate kinds are scoped to descendants of
 * the form via Playwright Locator chaining (uniform, deterministic filter).
 * @param args - Bundled page + candidates + timeout + formAnchor.
 * @returns Procedure with IRaceResult — found=true if clicked, NOT_FOUND_RESULT if not found.
 */
async function resolveAndClickImpl(args: IClickResolveArgs): Promise<Procedure<IRaceResult>> {
  const effectiveTimeout = capTimeout(args.timeout);
  const raceArgs: IClickResolveArgs = { ...args, timeout: effectiveTimeout };
  const result = await resolveVisibleNthAware(raceArgs);
  const visiblePath = await tryVisibleClickPath(result, effectiveTimeout);
  if (isSome(visiblePath)) return visiblePath.value;
  return tryAttachedClickFallback(args, effectiveTimeout);
}

/**
 * Build resolveVisible method bound to a page.
 * @param page - The Playwright page.
 * @returns Mediator resolveVisible function.
 */
function buildResolveVisible(page: Page): IElementMediator['resolveVisible'] {
  return (candidates, timeoutMs?, formAnchor?): Promise<IRaceResult> => {
    if (candidates.length === 0) return Promise.resolve(NOT_FOUND_RESULT);
    const timeout = timeoutMs ?? CLICK_RACE_TIMEOUT;
    const anchor = formAnchor ?? NO_FORM_ANCHOR;
    return resolveVisibleImpl({ page, candidates, timeout, formAnchor: anchor });
  };
}

/**
 * Build resolveAllVisible method bound to a page.
 * @param page - The Playwright page.
 * @returns Mediator resolveAllVisible function.
 */
function buildResolveAllVisible(page: Page): IElementMediator['resolveAllVisible'] {
  return (candidates, timeoutMs, cap): Promise<readonly IRaceResult[]> => {
    if (candidates.length === 0) return Promise.resolve([]);
    if (cap < 1) return Promise.resolve([]);
    return resolveAllVisibleImpl({ page, candidates, timeout: timeoutMs, cap });
  };
}

/**
 * Build resolveVisibleInContext method — scoped to a single frame.
 * @returns Mediator resolveVisibleInContext function.
 */
function buildResolveVisibleInContext(): IElementMediator['resolveVisibleInContext'] {
  return (candidates, context, timeoutMs?): Promise<IRaceResult> => {
    if (candidates.length === 0) return Promise.resolve(NOT_FOUND_RESULT);
    const timeout = timeoutMs ?? CLICK_RACE_TIMEOUT;
    return resolveVisibleInContextImpl(context, candidates, timeout);
  };
}

/**
 * Pick the WK_LOGIN_FORM.submit fallback when caller passes empty
 * candidates; otherwise return the caller's candidates as-is. Plain
 * ternary on a binary input — no dispatch table needed for a single
 * truth-valued switch.
 * @param callerCandidates - Candidates passed by the caller (possibly empty).
 * @returns Effective candidates for the click race.
 */
function pickClickCandidates(
  callerCandidates: readonly SelectorCandidate[],
): readonly SelectorCandidate[] {
  return callerCandidates.length === 0 ? WK_LOGIN_FORM.submit : callerCandidates;
}

/**
 * Build resolveAndClick method bound to a page.
 * Reads optional formAnchor from caller; passes through to the impl which
 * scopes ALL candidate kinds via Playwright Locator chaining.
 * @param page - The Playwright page.
 * @returns Mediator resolveAndClick function.
 */
function buildResolveAndClick(page: Page): IElementMediator['resolveAndClick'] {
  return (candidates, timeoutMs?, formAnchor?): Promise<Procedure<IRaceResult>> => {
    const timeout = timeoutMs ?? CLICK_RACE_TIMEOUT;
    const anchor = formAnchor ?? NO_FORM_ANCHOR;
    const useCandidates = pickClickCandidates(candidates);
    return resolveAndClickImpl({ page, candidates: useCandidates, timeout, formAnchor: anchor });
  };
}

/**
 * Build getFormAnchor method bound to the per-instance form cache.
 * Returns the cached form selector populated by `discoverForm`, or '' when
 * none discovered yet. Caller passes this to `resolveAndClick` so click
 * resolution is form-scoped.
 * @param cache - Per-instance form cache.
 * @returns Mediator getFormAnchor function.
 */
function buildGetFormAnchor(cache: IFormCache): IElementMediator['getFormAnchor'] {
  return (): string => cache.selector;
}

/** Resolver methods — locator + click resolution surfaces. */
export type ResolveBundle = Pick<
  IElementMediator,
  | 'resolveField'
  | 'resolveClickable'
  | 'resolveVisible'
  | 'resolveAllVisible'
  | 'resolveVisibleInContext'
  | 'resolveAndClick'
>;

/** Form-anchor cache surfaces — bound to a per-instance IFormCache. */
export type FormBundle = Pick<IElementMediator, 'discoverForm' | 'scopeToForm' | 'getFormAnchor'>;

/**
 * Build the 6-method locator resolver cluster.
 * @param page - The Playwright page to bind resolvers to.
 * @returns Locator/click resolver method bundle.
 */
export function buildResolveCluster(page: Page): ResolveBundle {
  return {
    resolveField: buildResolveField(page),
    resolveClickable: buildResolveClickable(page),
    resolveVisible: buildResolveVisible(page),
    resolveAllVisible: buildResolveAllVisible(page),
    resolveVisibleInContext: buildResolveVisibleInContext(),
    resolveAndClick: buildResolveAndClick(page),
  };
}

/**
 * Build the 3-method form-anchor cluster. Binds to per-instance cache so
 * concurrent ElementMediator instances do not share form-anchor state.
 * @param cache - The per-instance form-anchor cache.
 * @returns Form-anchor method bundle.
 */
export function buildFormCluster(cache: IFormCache): FormBundle {
  return {
    discoverForm: buildDiscoverForm(cache),
    scopeToForm: buildScopeToForm(cache),
    getFormAnchor: buildGetFormAnchor(cache),
  };
}
