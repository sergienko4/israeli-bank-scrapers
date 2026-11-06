/**
 * The one JSON body serializer. Every place that needs a POST body's
 * JSON — the `json` body writer, a body digest, an HMAC header signer —
 * takes it from here, so the bytes a header covers are the bytes sent.
 */

import type { ApiPostData } from '../../Types/Domain/ApiPostData.js';

/** A JSON body as the text sent and that text's UTF-8 bytes. */
interface ISerializedJsonBody {
  readonly text: string;
  readonly bytes: Buffer;
}

/**
 * Serialize a POST body to its JSON text and the UTF-8 bytes of that text.
 * @param body - POST body.
 * @returns JSON text and its bytes.
 */
function serializeJsonBody(body: ApiPostData): ISerializedJsonBody {
  const text = JSON.stringify(body);
  const bytes = Buffer.from(text, 'utf8');
  return { text, bytes };
}

export default serializeJsonBody;
export type { ISerializedJsonBody };
export { serializeJsonBody };
