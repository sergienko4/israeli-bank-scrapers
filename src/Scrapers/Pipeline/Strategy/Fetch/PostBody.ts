/**
 * POST body writers for the native transports (N9, N23). `json` writes the
 * body as JSON text under the transport's default content-type; `form` writes
 * a flat record as `application/x-www-form-urlencoded` in key order;
 * `form-latin1` does the same over ISO-8859-1; `text` sends the one string
 * field of a `{ text }` record verbatim. Every non-JSON writer replaces any
 * content-type the caller named — `text` by sending none — so a body never
 * travels under a type it is not. A writer that cannot write its body refuses
 * it with a fixed reason, before any request.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { type BodyEncoding, TEXT_BODY_REFUSED_REASON } from '../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import type { PostData } from './FetchStrategy.js';
import { serializeJsonBody } from './JsonBody.js';
import { encodeLatin1Form } from './Latin1Form.js';

/** Content-type every form body is sent under. */
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

/** Content-type every latin1 form body is sent under. */
const LATIN1_CONTENT_TYPE = `${FORM_CONTENT_TYPE}; charset=ISO-8859-1`;

/**
 * A written POST body and the content-type it imposes: a type replaces the
 * caller's, `false` removes it, absent keeps the transport's.
 */
interface IWrittenBody {
  readonly body: string;
  readonly contentType?: string | false;
}

/** Writes one POST body, or refuses it with a fixed reason. */
type BodyWriter = (data: PostData) => Procedure<IWrittenBody>;

/**
 * Write the body as JSON text — the one serializer's text, so a digest or
 * signature over its bytes covers exactly what is sent.
 * @param data - POST body.
 * @returns JSON text; the transport's content-type stands.
 */
function writeJson(data: PostData): Procedure<IWrittenBody> {
  const serialized = serializeJsonBody(data);
  return succeed({ body: serialized.text });
}

/**
 * Whether a value can travel as one form field.
 * @param value - Candidate field value.
 * @returns True for a string, finite number or boolean.
 */
function isFormScalar(value: unknown): boolean {
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Whether a body is a record of form scalars, not an array or nested value.
 * @param data - Candidate body.
 * @returns True when every own value can be encoded as one form field.
 */
function isFlatFormBody(data: unknown): boolean {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  return Object.values(data).every(isFormScalar);
}

/**
 * Text of one form value: a string as is, any other value as its JSON text.
 * @param value - Field value; the step guard keeps it a scalar.
 * @returns Field text.
 */
function formText(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * A flat record's fields as name and text pairs, in key order.
 * @param data - Flat POST record.
 * @returns Field pairs.
 */
function formPairs(data: PostData): [string, string][] {
  return Object.entries(data).map(([key, value]): [string, string] => [key, formText(value)]);
}

/**
 * Write a flat record URL-encoded, in key order.
 * @param data - Flat POST record.
 * @returns Form text and the form content-type.
 */
function writeForm(data: PostData): Procedure<IWrittenBody> {
  if (!isFlatFormBody(data)) return fail(ScraperErrorTypes.Generic, 'form body not flat');
  const body = new URLSearchParams(formPairs(data)).toString();
  return succeed({ body, contentType: FORM_CONTENT_TYPE });
}

/**
 * Write a flat record URL-encoded over ISO-8859-1, in key order.
 * @param data - Flat POST record.
 * @returns Form text and the latin1 form content-type, or the latin1 refusal.
 */
function writeLatin1Form(data: PostData): Procedure<IWrittenBody> {
  if (!isFlatFormBody(data)) return fail(ScraperErrorTypes.Generic, 'form body not flat');
  const pairs = formPairs(data);
  const encoded = encodeLatin1Form(pairs);
  if (!isOk(encoded)) return encoded;
  return succeed({ body: encoded.value, contentType: LATIN1_CONTENT_TYPE });
}

/**
 * Whether a body is exactly one string field named `text`.
 * @param data - POST body.
 * @returns True for a `{ text: string }` record.
 */
function isTextRecord(data: PostData): data is Readonly<{ text: string }> {
  if (Array.isArray(data)) return false;
  const keys = Object.keys(data);
  return keys.length === 1 && typeof (data as Readonly<{ text?: unknown }>).text === 'string';
}

/**
 * Write the text of a `{ text }` record verbatim, with no content-type.
 * @param data - POST body.
 * @returns The text, or the text-body refusal.
 */
function writeText(data: PostData): Procedure<IWrittenBody> {
  if (!isTextRecord(data)) return fail(ScraperErrorTypes.Generic, TEXT_BODY_REFUSED_REASON);
  return succeed({ body: data.text, contentType: false });
}

/** Writer per body encoding. */
const BODY_WRITERS: Readonly<Record<BodyEncoding, BodyWriter>> = {
  json: writeJson,
  form: writeForm,
  'form-latin1': writeLatin1Form,
  text: writeText,
};

/**
 * Write a POST body under its encoding.
 * @param data - POST body.
 * @param encoding - Body encoding; `json` when absent.
 * @returns Written body, or the writer's fixed refusal.
 */
function writePostBody(data: PostData, encoding: BodyEncoding = 'json'): Procedure<IWrittenBody> {
  return BODY_WRITERS[encoding](data);
}

/**
 * Headers with the written body's content-type in place of any other.
 * @param headers - Merged request headers.
 * @param written - Written body.
 * @returns Headers unchanged when the body imposes nothing; with no
 *   content-type when it removes it.
 */
function withBodyContentType(
  headers: Record<string, string>,
  written: IWrittenBody,
): Record<string, string> {
  if (written.contentType === undefined) return headers;
  const kept = Object.entries(headers).filter(([name]): boolean => {
    return name.toLowerCase() !== 'content-type';
  });
  const rest = Object.fromEntries(kept);
  if (written.contentType === false) return rest;
  return { ...rest, 'content-type': written.contentType };
}

export { isFlatFormBody, withBodyContentType, writePostBody };
