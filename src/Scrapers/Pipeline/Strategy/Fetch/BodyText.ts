/**
 * Body text (N63) — every native reader takes an answer's body through here.
 * A call whose reading is `strictUtf8` decodes the bytes as UTF-8 with
 * `fatal`, so a malformed byte refuses the call instead of becoming U+FFFD;
 * any other call reads the body as `Response.text()` does. Both drop a
 * leading BOM. A refusal names the request URL only, never the body.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { BODY_NOT_UTF8_REASON } from '../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { safeUrlForLog } from './SafeUrlForLog.js';
import type { IAnswer } from './StatusPolicy.js';

/** UTF-8 decoder that throws on a malformed sequence and drops a BOM. */
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Decode an answer's bytes as strict UTF-8.
 * @param answer - The answered call.
 * @param bytes - The answer's body bytes.
 * @returns The text, or the fixed refusal naming the request URL only.
 */
function decodeStrict(answer: IAnswer, bytes: ArrayBuffer): Procedure<string> {
  try {
    const text = STRICT_UTF8.decode(bytes);
    return succeed(text);
  } catch {
    const safeUrl = safeUrlForLog(answer.url);
    return fail(ScraperErrorTypes.Generic, `${answer.verb} ${safeUrl} ${BODY_NOT_UTF8_REASON}`);
  }
}

/**
 * Read an answer's body as text, strictly when its reading says so.
 * @param answer - A 2xx answer past the status and media type checks.
 * @returns The body text, or the strict-decoding refusal.
 */
async function readBodyText(answer: IAnswer): Promise<Procedure<string>> {
  if (answer.reading.strictUtf8 !== true) {
    const text = await answer.response.text();
    return succeed(text);
  }
  const bytes = await answer.response.arrayBuffer();
  return decodeStrict(answer, bytes);
}

export default readBodyText;
export { readBodyText };
