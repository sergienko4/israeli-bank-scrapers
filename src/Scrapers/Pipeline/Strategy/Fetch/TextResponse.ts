/**
 * Text responses (N23) — a `text` call reads its 2xx answer as a string and
 * hands it over as `{ text }`, so the step's extracts read it at `/text`. An
 * answer over the call's `maxTextChars` (65 536 chars by default) is refused,
 * never truncated. WAF classification and the status policy have already run,
 * so an edge page never reaches this reader. The body is read through
 * `readBodyText` (N63).
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { TEXT_TOO_LONG_REASON } from '../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { readBodyText } from './BodyText.js';
import { safeUrlForLog } from './SafeUrlForLog.js';
import type { IAnswer } from './StatusPolicy.js';

/** Longest text answer a call accepts when it names no cap, in chars. */
const TEXT_ANSWER_CAP = 65_536;

/**
 * Read a text answer, refusing one over the call's cap.
 * @param answer - A 2xx answer on a text call.
 * @returns `{ text }`, or a Generic failure naming the request URL only.
 */
async function readText<T>(answer: IAnswer): Promise<Procedure<T>> {
  const read = await readBodyText(answer);
  if (!isOk(read)) return read;
  const text = read.value;
  const cap = answer.reading.maxTextChars ?? TEXT_ANSWER_CAP;
  if (text.length <= cap) return succeed({ text } as T);
  const safeUrl = safeUrlForLog(answer.url);
  return fail(ScraperErrorTypes.Generic, `${answer.verb} ${safeUrl} ${TEXT_TOO_LONG_REASON}`);
}

export default readText;
export { readText };
