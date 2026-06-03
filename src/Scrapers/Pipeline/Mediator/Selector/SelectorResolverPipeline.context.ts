/**
 * Map an IFieldMatch → fully populated IFieldContext, with trace logging.
 */

import { getDebug } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { IFieldContext, IFieldMatch } from './SelectorResolverPipeline.types.js';

const LOG = getDebug(import.meta.url);

/**
 * Emit the trace row recording which strategy/value matched.
 * @param match - Raw match.
 * @param via - resolvedVia tag for the log line.
 * @returns Sentinel `true` so the call can be expression-chained.
 */
function traceMatch(match: IFieldMatch, via: IFieldContext['resolvedVia']): true {
  LOG.trace({
    wkKey: match.selector,
    strategy: match.kind ?? 'unknown',
    matchValue: maskVisibleText(match.selector),
    via,
  });
  return true;
}

/**
 * Convert a field match to a fully populated IFieldContext.
 * @param match - The field match containing selector and context.
 * @param via - Whether resolved via bankConfig or wellKnown.
 * @param round - Whether resolved in iframe or mainPage.
 * @returns A IFieldContext with isResolved=true.
 */
function toFieldContext(
  match: IFieldMatch,
  via: IFieldContext['resolvedVia'],
  round: IFieldContext['round'],
): IFieldContext {
  const { selector, context, kind } = match;
  traceMatch(match, via);
  return { isResolved: true, selector, context, resolvedVia: via, round, resolvedKind: kind };
}

export default toFieldContext;

export { toFieldContext };
