/**
 * N61 — the media type check a native transport runs on a 2xx answer, after
 * WAF classification and the status policy, before the reader. The answer's
 * media type is its content-type before any `;`, trimmed and lower-cased; it
 * must equal the call's expected type exactly. The refusal names the verb and
 * the safe URL only — never the header value.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { MEDIA_TYPE_REFUSED_REASON } from '../../Types/Domain/FetchPolicy.js';
import type { Option } from '../../Types/Option.js';
import { none, some } from '../../Types/Option.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';
import { safeUrlForLog } from './SafeUrlForLog.js';
import type { IAnswer } from './StatusPolicy.js';

/**
 * The media type an answer names: its content-type before any parameter.
 * @param response - The answered response.
 * @returns Lower-case `type/subtype`, or empty when no content-type was sent.
 */
function mediaTypeOf(response: Response): string {
  const contentType = response.headers.get('content-type') ?? '';
  const [mediaType] = contentType.split(';');
  return mediaType.trim().toLowerCase();
}

/**
 * Refuse an answer whose media type is not the one the call expects.
 * @param answer - The answered call.
 * @returns The refusal, or none when the call expects no type or it matches.
 */
function refuseMediaType<T>(answer: IAnswer): Option<Procedure<T>> {
  const expected = answer.reading.mediaType;
  if (expected === undefined) return none();
  const actual = mediaTypeOf(answer.response);
  if (actual === expected) return none();
  const safeUrl = safeUrlForLog(answer.url);
  const message = `${answer.verb} ${safeUrl} ${MEDIA_TYPE_REFUSED_REASON}`;
  const refused = fail(ScraperErrorTypes.Generic, message);
  return some(refused);
}

export default refuseMediaType;
export { refuseMediaType };
