/**
 * Test-only narrowing for POST data. A shape's `buildVars` and a
 * captured request body are ApiPostData — an object or a top-level array —
 * so a test that reads named fields first proves the data is an object.
 */

import type { ApiPostData } from '../../Scrapers/Pipeline/Types/Domain/ApiPostData.js';
import type { JsonUnknownRecord } from '../../Scrapers/Pipeline/Types/JsonValue.js';

/**
 * Asserts POST data is an object, not a top-level array.
 * @param data - Vars a shape built, or a captured request body.
 * @returns Result.
 */
function assertPostObject(data: ApiPostData): asserts data is Readonly<JsonUnknownRecord> {
  const isArray = Array.isArray(data);
  expect(isArray).toBe(false);
}

export default assertPostObject;
export { assertPostObject };
