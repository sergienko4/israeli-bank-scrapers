/**
 * JSON responses share the body decoder with document and text readers,
 * preserving the call's strict UTF-8 policy before parsing.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { describeJsonParseFailure } from '../../Types/JsonParseFailure.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { readBodyText } from './BodyText.js';
import { safeUrlForLog } from './SafeUrlForLog.js';
import type { IAnswer } from './StatusPolicy.js';

/**
 * Parse an answer's body text as JSON, with a structured failure on malformed input.
 * @param answer - The answered call.
 * @param rawText - The answer's body text.
 * @returns Procedure carrying the parsed body, or a parse-error failure.
 */
function parseJsonText<T>(answer: IAnswer, rawText: string): Procedure<T> {
  try {
    const parsed = JSON.parse(rawText) as T;
    return succeed(parsed);
  } catch (error) {
    const reason = describeJsonParseFailure(error);
    const safeUrl = safeUrlForLog(answer.url, answer.reading.redactUrlValues);
    return fail(ScraperErrorTypes.Generic, `${answer.verb} ${safeUrl} parse error: ${reason}`);
  }
}

/**
 * Read an answer's body (strictly when its reading says so) and parse it as JSON.
 * @param answer - The answered call.
 * @returns Procedure carrying the parsed body, or a decoding or parse failure.
 */
async function parseJsonResponse<T>(answer: IAnswer): Promise<Procedure<T>> {
  const rawText = await readBodyText(answer);
  if (!isOk(rawText)) return rawText;
  return parseJsonText<T>(answer, rawText.value);
}

export default parseJsonResponse;
export { parseJsonResponse };
