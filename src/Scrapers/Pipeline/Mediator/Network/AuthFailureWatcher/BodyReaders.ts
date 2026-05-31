/**
 * AuthFailureWatcher BodyReaders — safe response-body extraction helpers.
 */

import type { Response } from 'playwright-core';

import type { JsonValue } from '../../../Types/JsonValue.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { BODY_PREVIEW_LIMIT, NO_PARSED_BODY } from './Types.js';

/**
 * Read response body text safely; returns empty string on any error.
 * @param response - Playwright response object.
 * @returns Raw body text up to the preview limit, masked + truncated.
 */
export async function safeBodyPreview(response: Response): Promise<string> {
  const raw = await response.text().catch((): string => '');
  const slice = raw.slice(0, BODY_PREVIEW_LIMIT);
  return maskVisibleText(slice);
}

/**
 * Try to parse a response body as JSON for L2 inspection. Returns the
 * NO_PARSED_BODY sentinel string when no body could be parsed.
 * @param response - Playwright response object.
 * @returns Parsed value, or NO_PARSED_BODY sentinel on any error.
 */
export async function safeParsedBody(response: Response): Promise<JsonValue> {
  const text = await response.text().catch((): string => '');
  if (text.length === 0) return NO_PARSED_BODY;
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return NO_PARSED_BODY;
  }
}
