/**
 * POST body writers for the native transports (N9). `json` writes the body as
 * JSON text under the transport's default content-type; `form` writes a flat
 * record as `application/x-www-form-urlencoded` in key order and replaces any
 * content-type the caller named, so a form body never travels as JSON.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { BodyEncoding } from '../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { PostData } from './FetchStrategy.js';

/** Content-type every form body is sent under. */
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

/** A written POST body and the content-type it imposes, when it imposes one. */
interface IWrittenBody {
  readonly body: string;
  readonly contentType?: string;
}

/** Writes one POST body. */
type BodyWriter = (data: PostData) => Procedure<IWrittenBody>;

/**
 * Write the body as JSON text.
 * @param data - POST body.
 * @returns JSON text; the transport's content-type stands.
 */
function writeJson(data: PostData): Procedure<IWrittenBody> {
  return succeed({ body: JSON.stringify(data) });
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
 * Write a flat record URL-encoded, in key order.
 * @param data - Flat POST record.
 * @returns Form text and the form content-type.
 */
function writeForm(data: PostData): Procedure<IWrittenBody> {
  if (!isFlatFormBody(data)) return fail(ScraperErrorTypes.Generic, 'form body not flat');
  const pairs = Object.entries(data).map(([key, value]): [string, string] => [
    key,
    formText(value),
  ]);
  const body = new URLSearchParams(pairs).toString();
  return succeed({ body, contentType: FORM_CONTENT_TYPE });
}

/** Writer per body encoding. */
const BODY_WRITERS: Readonly<Record<BodyEncoding, BodyWriter>> = {
  json: writeJson,
  form: writeForm,
};

/**
 * Write a POST body under its encoding.
 * @param data - POST body.
 * @param encoding - Body encoding; `json` when absent.
 * @returns Written body.
 */
function writePostBody(data: PostData, encoding: BodyEncoding = 'json'): Procedure<IWrittenBody> {
  return BODY_WRITERS[encoding](data);
}

/**
 * Headers with the written body's content-type in place of any other.
 * @param headers - Merged request headers.
 * @param written - Written body.
 * @returns Headers unchanged when the body imposes no content-type.
 */
function withBodyContentType(
  headers: Record<string, string>,
  written: IWrittenBody,
): Record<string, string> {
  if (written.contentType === undefined) return headers;
  const kept = Object.entries(headers).filter(([name]): boolean => {
    return name.toLowerCase() !== 'content-type';
  });
  return { ...Object.fromEntries(kept), 'content-type': written.contentType };
}

export { isFlatFormBody, withBodyContentType, writePostBody };
