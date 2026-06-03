/**
 * Diagnostic logging helpers for PipelineFieldResolver.
 */

import { getDebug } from '../../Types/Debug.js';
import type { Option } from '../../Types/Option.js';
import { EMPTY_METADATA } from '../Elements/MetadataExtractors.js';
import type { IPipelineFieldContext } from './PipelineFieldResolver.types.js';

const LOG = getDebug(import.meta.url);

/**
 * Pick the WK concept name from an Option slot, defaulting to 'CUSTOM'.
 * @param slot - WK concept slot Option.
 * @returns The slot value or the 'CUSTOM' literal.
 */
function deriveConcept(slot: Option<string>): string {
  return slot.has ? slot.value : 'CUSTOM';
}

/** Bundle for buildResolvedPayload (keeps signature single-line). */
interface IPayloadArgs {
  /** Credential key. */
  readonly fieldKey: string;
  /** Enriched field context. */
  readonly enriched: IPipelineFieldContext;
  /** WK concept slot Option. */
  readonly wkSlot: Option<string>;
}

/** Element-level payload subset (avoids inflating buildResolvedPayload LoC). */
interface IElementPayload {
  /** Element id attribute. */
  readonly elementId: string;
  /** Element tag name (lower-case). */
  readonly elementTag: string;
  /** Element class list joined by spaces. */
  readonly elementClasses: string;
}

/**
 * Project the element-metadata trio off the enriched context.
 * @param enriched - Enriched field context.
 * @returns Element-level subset for the diag payload.
 */
function elementSubset(enriched: IPipelineFieldContext): IElementPayload {
  const meta = enriched.metadata ?? EMPTY_METADATA;
  return { elementId: meta.id, elementTag: meta.tagName, elementClasses: meta.className };
}

/**
 * Build the diag-log payload for a resolved field.
 * @param args - {@link IPayloadArgs} bundle.
 * @returns Payload record (debug-only shape).
 */
function buildResolvedPayload(args: IPayloadArgs): Record<string, string> {
  const subset = elementSubset(args.enriched);
  const strategy = args.enriched.resolvedKind ?? 'unknown';
  const wkConcept = deriveConcept(args.wkSlot);
  return { field: args.fieldKey, wkConcept, strategy, ...subset };
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
  const payload = buildResolvedPayload({ fieldKey, enriched, wkSlot });
  LOG.debug(payload);
  return true;
}

export default logResolvedDetails;

export { logResolvedDetails };
