/**
 * Pipeline-aware field resolver.
 * Uses PIPELINE_WELL_KNOWN_LOGIN (text-only, zero CSS) as the well-known fallback,
 * then enriches the resolved IFieldContext with DOM metadata via MetadataExtractors.
 *
 * Reuses the exported resolution primitives from SelectorResolverPipeline.ts —
 * no modification to shared infrastructure required.
 */

import type { Frame, Page } from 'playwright-core';

import { isPage } from '../../../Common/SelectorResolver.js';
import {
  buildNotFoundContext,
  type IFieldContext,
  type IResolveAllOpts,
  probeIframes,
  probeMainPage,
} from '../../../Common/SelectorResolverPipeline.js';
import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import { PIPELINE_WELL_KNOWN_LOGIN } from '../Registry/PipelineWellKnown.js';
import { extractMetadata, type IElementMetadata } from './MetadataExtractors.js';

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
  return 'url' in pageOrFrame ? (pageOrFrame as Page).url() : '';
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
  return {
    pageOrFrame,
    field: { credentialKey: fieldKey, selectors: [...candidates.bank] },
    pageUrl: getContextUrl(pageOrFrame),
    bankCandidates: [...candidates.bank],
    wellKnownCandidates: [...candidates.wk],
  };
}

/**
 * Run the resolution pipeline: iframes first, then main page.
 * @param pageOrFrame - Page or Frame to search in.
 * @param opts - Pre-built resolve options.
 * @returns Resolved IFieldContext (may have isResolved=false on failure).
 */
async function probeAll(pageOrFrame: Page | Frame, opts: IResolveAllOpts): Promise<IFieldContext> {
  if (isPage(pageOrFrame)) {
    const iframeResult = await probeIframes(pageOrFrame, opts);
    if ('isResolved' in iframeResult) return iframeResult;
  }
  const mainResult = await probeMainPage(opts);
  if ('isResolved' in mainResult) return mainResult;
  return buildNotFoundContext(opts);
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
  const metadata = await extractMetadata(result.context, result.selector).catch(() => undefined);
  return { ...result, metadata };
}

/**
 * Resolve a login field using pipeline text-only well-known candidates.
 * Finds the element by visible Hebrew text, then extracts DOM metadata.
 * @param pageOrFrame - Page or Frame to search in.
 * @param fieldKey - Credential key (e.g. 'username', 'password', 'id').
 * @param bankCandidates - Bank-specific selector candidates (text-based, no CSS).
 * @returns IPipelineFieldContext with full DOM metadata if resolved.
 */
export async function resolveFieldPipeline(
  pageOrFrame: Page | Frame,
  fieldKey: string,
  bankCandidates: readonly SelectorCandidate[],
): Promise<IPipelineFieldContext> {
  const wkKey = fieldKey as keyof typeof PIPELINE_WELL_KNOWN_LOGIN;
  const wk = PIPELINE_WELL_KNOWN_LOGIN[wkKey];
  const opts = buildResolveOpts(pageOrFrame, fieldKey, { bank: bankCandidates, wk });
  const result = await probeAll(pageOrFrame, opts);
  return enrichWithMetadata(result);
}
