/**
 * Metadata enrichment for resolved IFieldContext.
 */

import {
  EMPTY_METADATA,
  extractMetadata,
  type IElementMetadata,
} from '../Elements/MetadataExtractors.js';
import type { IPipelineFieldContext } from './PipelineFieldResolver.types.js';
import type { IFieldContext } from './SelectorResolverPipeline.js';

/**
 * Best-effort fallback for metadata extraction failures.
 * @returns Empty metadata.
 */
function emptyMetadata(): IElementMetadata {
  return EMPTY_METADATA;
}

/**
 * Enrich a resolved IFieldContext with DOM metadata.
 * Skips extraction when the upstream resolver did not find an element,
 * because document.querySelector inside extractMetadata cannot parse
 * Playwright-specific selectors (xpath=, label walk-up, etc.).
 * @param result - The base field context.
 * @returns IPipelineFieldContext with metadata added if element was resolved.
 */
async function enrichWithMetadata(result: IFieldContext): Promise<IPipelineFieldContext> {
  if (!result.isResolved) return result;
  const metadata = await extractMetadata(result.context, result.selector).catch(emptyMetadata);
  return { ...result, metadata };
}

export default enrichWithMetadata;

export { enrichWithMetadata };
