/**
 * Test-only assertion helpers for Procedure and Option types.
 * Combines expect + type narrowing in a single call — eliminates bare `return;` guards.
 */

import type { Option } from '../../Scrapers/Pipeline/Types/Option.js';
import type { Procedure } from '../../Scrapers/Pipeline/Types/Procedure.js';

/**
 * Asserts Procedure succeeded and narrows to `{ success: true; value: T }`.
 * @param result - The Procedure to assert.
 */
function assertOk<T>(
  result: Procedure<T>,
): asserts result is { readonly success: true; readonly value: T } {
  expect(result.success).toBe(true);
}

/**
 * Asserts Option has a value and narrows to `{ has: true; value: T }`.
 * @param opt - The Option to assert.
 */
function assertHas<T>(opt: Option<T>): asserts opt is { readonly has: true; readonly value: T } {
  expect(opt.has).toBe(true);
}

export { assertHas, assertOk };
