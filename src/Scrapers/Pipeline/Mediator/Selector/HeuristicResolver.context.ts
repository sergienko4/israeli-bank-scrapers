/**
 * Per-frame heuristic resolution + IFieldContext mapping.
 */

import type { Frame, Page } from 'playwright-core';

import { getDebug } from '../../Types/Debug.js';
import { emptyMatch } from './HeuristicResolver.probes.js';
import { STRATEGY_HANDLERS } from './HeuristicResolver.strategies.js';
import { HEURISTIC_MAP } from './HeuristicResolver.types.js';
import type { IFieldContext, IFieldMatch } from './SelectorResolverPipeline.js';

const LOG = getDebug(import.meta.url);

/**
 * Resolve a field using heuristics within a specific frame.
 * Wraps in try/catch so mock frames without .locator() fail gracefully.
 * @param frame - The page or frame to search.
 * @param fieldKey - The field type (id, password, etc).
 * @returns Field match with selector, or empty if not found.
 */
async function heuristicResolveInFrame(
  frame: Page | Frame,
  fieldKey: string,
): Promise<IFieldMatch> {
  const strategy = HEURISTIC_MAP[fieldKey];
  if (!strategy) return emptyMatch(frame);
  const handler = STRATEGY_HANDLERS[strategy.type];
  return handler(frame as Frame, fieldKey, strategy).catch((): IFieldMatch => emptyMatch(frame));
}

/**
 * Build the IFieldContext payload for a heuristic match.
 * @param match - The field match from heuristic resolution.
 * @returns Resolved IFieldContext (without logging).
 */
function buildHeuristicContext(match: IFieldMatch): IFieldContext {
  return {
    isResolved: true,
    selector: match.selector,
    context: match.context,
    resolvedVia: 'heuristic',
    round: 'heuristic',
    resolvedKind: 'css',
  };
}

/**
 * Convert a heuristic match to IFieldContext.
 * @param match - The field match from heuristic resolution.
 * @param fieldKey - Credential key for logging.
 * @returns IFieldContext with heuristic metadata.
 */
function toHeuristicContext(match: IFieldMatch, fieldKey: string): IFieldContext {
  LOG.debug({ field: `heuristic:${fieldKey}`, result: 'FOUND' });
  return buildHeuristicContext(match);
}

export { heuristicResolveInFrame, toHeuristicContext };
