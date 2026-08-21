/**
 * Upper bound of the scrape window.
 *
 * Every bank whose request carries an end date derives it from "now", each in
 * its own format — `YYYYMMDD` in a query param (Hapoalim), `YYYY-MM-DD` in a
 * body (the BaNCS family, Pepper), RFC-1123 inside a JSON string (Leumi), a
 * structured `{Day,Month,Year}` filter (Yahav), or a billing month (Isracard,
 * Amex, Max, VisaCal). Because the encodings share nothing, the bound cannot
 * be narrowed by rewriting the serialized request without bank-specific code.
 *
 * The bound itself, however, is uniform: it is always "the end of the window
 * we are asking about". Reading it from the context instead of the clock lets
 * one change serve every encoding — and lets the coverage backfill re-request
 * an older slice simply by handing the shape a different context.
 */

import { none, type Option, unwrapOr } from '../../Types/Option.js';
import type { IActionContext } from '../../Types/PipelineContext.js';

/**
 * Read the bound slot from a context as Option.
 *
 * `windowEnd` is required on {@link IActionContext}, so production builders
 * must state it and the compiler enumerates any that forget. Synthetic
 * contexts in unit tests are partial casts that carry only the fields under
 * test, and a context that never mentions a bound is precisely an unbounded
 * one — the same reading {@link none} already gives. Normalising here mirrors
 * `readSlot` in ApiMediatorAccessor, the established accessor idiom.
 * @param ctx - Action context.
 * @returns Option carrying the narrowed bound.
 */
function readBound(ctx: IActionContext): Option<Date> {
  const slot = ctx.windowEnd as Option<Date> | undefined;
  if (slot === undefined) return none();
  return slot;
}

/**
 * The scrape window's upper bound — the narrowed bound when a backfill pass
 * set one, otherwise the present moment.
 * @param ctx - Action context.
 * @returns Date every shape must treat as the end of its window.
 */
export function scrapeWindowEnd(ctx: IActionContext): Date {
  const bound = readBound(ctx);
  const now = new Date();
  return unwrapOr(bound, now);
}

export default scrapeWindowEnd;
