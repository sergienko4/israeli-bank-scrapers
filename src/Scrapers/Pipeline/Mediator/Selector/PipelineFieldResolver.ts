/**
 * Pipeline-aware field resolver.
 * Uses WK.LOGIN.ACTION.FORM (text-only, zero CSS) as the well-known fallback,
 * then enriches the resolved IFieldContext with DOM metadata via MetadataExtractors.
 *
 * Reuses the exported resolution primitives from SelectorResolverPipeline.ts —
 * no modification to shared infrastructure required.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import { WK_CONCEPT_MAP, WK_LOGIN_FORM } from '../../Registry/WK/LoginWK.js';
import { getDebug } from '../../Types/Debug.js';
import { none, type Option, some } from '../../Types/Option.js';
import {
  EMPTY_METADATA,
  extractMetadata,
  type IElementMetadata,
} from '../Elements/MetadataExtractors.js';
import { scopeCandidates } from '../Form/FormAnchor.js';
import { tryHeuristicProbe } from './HeuristicResolver.js';
import { isPage } from './SelectorResolver.js';
import {
  buildNotFoundContext,
  type IFieldContext,
  type IResolveAllOpts,
  probeIframes,
  probeMainPage,
} from './SelectorResolverPipeline.js';

const LOG = getDebug(import.meta.url);

/**
 * Extended field context returned by the pipeline resolver.
 * Adds dynamically-extracted DOM metadata after text-based resolution.
 */
export interface IPipelineFieldContext extends IFieldContext {
  /** DOM metadata extracted after resolving the element by visible text. */
  readonly metadata?: IElementMetadata;
}

/** Bank and well-known candidates pair for field resolution. */
interface IFieldCandidates {
  readonly bank: readonly SelectorCandidate[];
  readonly wk: readonly SelectorCandidate[];
}

/**
 * Get the current URL safely from a Page or Frame.
 * @param pageOrFrame - Playwright Page or Frame.
 * @returns URL string, or empty string for frames.
 */
function getContextUrl(pageOrFrame: Page | Frame): string {
  if (!('url' in pageOrFrame)) return '';
  return (pageOrFrame as Page).url();
}

/**
 * Build IResolveAllOpts from page, field key, and candidate pair.
 * @param pageOrFrame - Page or Frame to search in.
 * @param fieldKey - Credential key for diagnostics.
 * @param candidates - Bank and well-known candidate pair.
 * @returns IResolveAllOpts ready for probing.
 */
function buildResolveOpts(
  pageOrFrame: Page | Frame,
  fieldKey: string,
  candidates: IFieldCandidates,
): IResolveAllOpts {
  const opts: IResolveAllOpts = {
    pageOrFrame,
    field: { credentialKey: fieldKey, selectors: [...candidates.bank] },
    pageUrl: getContextUrl(pageOrFrame),
    bankCandidates: [...candidates.bank],
    wellKnownCandidates: [...candidates.wk],
  };
  return opts;
}

/**
 * Run the resolution pipeline: iframes first, then main page.
 * @param pageOrFrame - Page or Frame to search in.
 * @param opts - Pre-built resolve options.
 * @returns Resolved IFieldContext (may have isResolved=false on failure).
 */
/**
 * Try iframe resolution first (only for Page, not Frame).
 * @param pageOrFrame - Page or Frame.
 * @param opts - Resolve options.
 * @returns Resolved context from iframe, or Option.none if not found.
 */
async function tryIframeProbe(
  pageOrFrame: Page | Frame,
  opts: IResolveAllOpts,
): Promise<Option<IFieldContext>> {
  if (!isPage(pageOrFrame)) return none();
  const result = await probeIframes(pageOrFrame, opts);
  if ('isResolved' in result) return some(result);
  return none();
}

/**
 * Log a not-found diagnostic and build the final not-found context.
 * @param opts - Resolve options containing field details.
 * @returns Not-resolved IFieldContext with diagnostic message.
 */
async function logAndBuildNotFound(opts: IResolveAllOpts): Promise<IFieldContext> {
  LOG.debug({ field: opts.field.credentialKey, result: 'NOT_FOUND' });
  return buildNotFoundContext(opts);
}

/**
 * Hot-path probe: iframes first, then main page.
 * @param pageOrFrame - Page or Frame to search in.
 * @param opts - Resolve options.
 * @returns Some(context) on hit, none() on miss.
 */
async function tryHotPath(
  pageOrFrame: Page | Frame,
  opts: IResolveAllOpts,
): Promise<Option<IFieldContext>> {
  const iframeResult = await tryIframeProbe(pageOrFrame, opts);
  if (iframeResult.has) return iframeResult;
  const mainResult = await probeMainPage(opts);
  if ('isResolved' in mainResult) return some(mainResult);
  return none();
}

/**
 * Run the resolution pipeline: iframes first, then main page.
 * @param pageOrFrame - Page or Frame to search in.
 * @param opts - Pre-built resolve options.
 * @returns Resolved IFieldContext (may have isResolved=false on failure).
 */
async function probeAll(pageOrFrame: Page | Frame, opts: IResolveAllOpts): Promise<IFieldContext> {
  const hot = await tryHotPath(pageOrFrame, opts);
  if (hot.has) return hot.value;
  LOG.trace({ field: opts.field.credentialKey, result: 'NOT_FOUND' });
  const heuristic = await tryHeuristicProbe(pageOrFrame, opts.field.credentialKey);
  if (heuristic) return heuristic;
  return logAndBuildNotFound(opts);
}

/**
 * Enrich a resolved IFieldContext with DOM metadata.
 * @param result - The base field context.
 * @returns IPipelineFieldContext with metadata added if element was resolved.
 */
async function enrichWithMetadata(result: IFieldContext): Promise<IPipelineFieldContext> {
  if (!result.isResolved) return result;
  // Skip metadata extraction for non-CSS selectors (xpath=, labelText walk-up, etc.)
  // document.querySelector inside extractMetadata doesn't handle Playwright-specific formats.
  /**
   * Metadata extraction is best-effort — returns empty on failure.
   * @returns Empty metadata.
   */
  const fallback = (): IElementMetadata => EMPTY_METADATA;
  const metadata = await extractMetadata(result.context, result.selector).catch(fallback);
  const enriched: IPipelineFieldContext = { ...result, metadata };
  return enriched;
}

/**
 * Apply form scoping to candidates if a form selector is present.
 * @param candidates - Raw candidates.
 * @param formSel - Form selector for scoping (empty string = no scope).
 * @returns Scoped or original candidates.
 */
function applyFormScope(
  candidates: readonly SelectorCandidate[],
  formSel: string,
): readonly SelectorCandidate[] {
  if (!formSel) return candidates;
  return scopeCandidates(formSel, [...candidates]);
}

/** Options for resolveFieldPipeline — bundled to satisfy max-params. */
export interface IResolveFieldArgs {
  readonly pageOrFrame: Page | Frame;
  readonly fieldKey: string;
  readonly bankCandidates: readonly SelectorCandidate[];
  readonly formSelector?: string;
}

/** Sentinel for no form scoping — avoids bare '' fallback. */
const NO_FORM_SCOPE = '';

/** Resolved WK concept slot + candidate list pair. */
interface IWkLookup {
  readonly slot: Option<string>;
  readonly wellKnown: readonly SelectorCandidate[];
}

/**
 * Look up well-known candidates for a field key.
 * @param fieldKey - Credential key.
 * @returns Slot label and candidate list (empty when no match).
 */
function resolveWkCandidates(fieldKey: string): IWkLookup {
  const wkSlot = WK_CONCEPT_MAP[fieldKey];
  if (wkSlot === undefined) return { slot: none(), wellKnown: [] };
  return { slot: some(wkSlot), wellKnown: WK_LOGIN_FORM[wkSlot] };
}

/**
 * Apply form scoping to bank + well-known candidate lists.
 * @param bank - Bank-specific candidates.
 * @param wellKnown - Well-known candidates.
 * @param formSelector - Optional form selector for scoping.
 * @returns Scoped candidate pair.
 */
function buildScopedCandidates(
  bank: readonly SelectorCandidate[],
  wellKnown: readonly SelectorCandidate[],
  formSelector?: string,
): IFieldCandidates {
  const scope = formSelector ?? NO_FORM_SCOPE;
  return { bank: applyFormScope(bank, scope), wk: applyFormScope(wellKnown, scope) };
}

/**
 * Emit the resolved-field diagnostic log row.
 * @param fieldKey - Credential key.
 * @param enriched - Enriched field context with metadata.
 * @param wkSlot - WK concept slot (Option) — `'CUSTOM'` is logged when none.
 * @returns Sentinel `true` so the call can be expression-chained.
 */
function logResolvedDetails(
  fieldKey: string,
  enriched: IPipelineFieldContext,
  wkSlot: Option<string>,
): true {
  const meta = enriched.metadata ?? EMPTY_METADATA;
  const concept = wkSlot.has ? wkSlot.value : 'CUSTOM';
  const strategy = enriched.resolvedKind ?? 'unknown';
  LOG.debug({
    field: fieldKey,
    wkConcept: concept,
    strategy,
    elementId: meta.id,
    elementTag: meta.tagName,
    elementClasses: meta.className,
  });
  return true;
}

/**
 * Resolve a login field using pipeline text-only well-known candidates.
 * Finds the element by visible Hebrew text, then extracts DOM metadata.
 * @param args - Bundled resolution arguments.
 * @returns IPipelineFieldContext with full DOM metadata if resolved.
 */
export async function resolveFieldPipeline(
  args: IResolveFieldArgs,
): Promise<IPipelineFieldContext> {
  const { slot, wellKnown } = resolveWkCandidates(args.fieldKey);
  const candidates = buildScopedCandidates(args.bankCandidates, wellKnown, args.formSelector);
  const opts = buildResolveOpts(args.pageOrFrame, args.fieldKey, candidates);
  const result = await probeAll(args.pageOrFrame, opts);
  const enriched = await enrichWithMetadata(result);
  if (enriched.isResolved) logResolvedDetails(args.fieldKey, enriched, slot);
  return enriched;
}
