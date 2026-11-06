/**
 * Document responses (N3) — a `document` step reads its 2xx answer as text,
 * checks it for the step's marker when one is set, and discards it: the step
 * sees `{}`. WAF classification has already run, so an edge page never
 * reaches this reader. The body is read through `readBodyText` (N63).
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { DOCUMENT_UNVERIFIED_REASON } from '../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk } from '../../Types/Procedure.js';
import { readBodyText } from './BodyText.js';
import { safeUrlForLog } from './SafeUrlForLog.js';
import type { IAnswer } from './StatusPolicy.js';
import { emptyAnswer } from './StatusPolicy.js';

/**
 * Read a document answer and verify its marker; no marker reads as the empty
 * string, which every page contains.
 * @param answer - A 2xx answer on a document step.
 * @returns `{}`, or a Generic failure naming the request URL only.
 */
async function readDocument<T>(answer: IAnswer): Promise<Procedure<T>> {
  const page = await readBodyText(answer);
  if (!isOk(page)) return page;
  const marker = answer.reading.documentMarker ?? '';
  if (page.value.includes(marker)) return emptyAnswer<T>();
  const safeUrl = safeUrlForLog(answer.url);
  return fail(ScraperErrorTypes.Generic, `${answer.verb} ${safeUrl} ${DOCUMENT_UNVERIFIED_REASON}`);
}

export default readDocument;
export { readDocument };
