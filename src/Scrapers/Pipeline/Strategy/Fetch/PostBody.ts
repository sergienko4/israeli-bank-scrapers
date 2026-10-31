/**
 * POST body writers for the native transports (N9). `json` writes the body as
 * JSON text under the transport's default content-type; `form` writes a flat
 * record as `application/x-www-form-urlencoded` in key order and replaces any
 * content-type the caller named, so a form body never travels as JSON.
 */

import type { BodyEncoding } from '../../Types/Domain/FetchPolicy.js';
import type { PostData } from './FetchStrategy.js';

/** Content-type every form body is sent under. */
const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

/** A written POST body and the content-type it imposes, when it imposes one. */
interface IWrittenBody {
  readonly body: string;
  readonly contentType?: string;
}

/** Writes one POST body. */
type BodyWriter = (data: PostData) => IWrittenBody;

/**
 * Write the body as JSON text.
 * @param data - POST body.
 * @returns JSON text; the transport's content-type stands.
 */
function writeJson(data: PostData): IWrittenBody {
  return { body: JSON.stringify(data) };
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
function writeForm(data: PostData): IWrittenBody {
  const pairs = Object.entries(data).map(([key, value]): [string, string] => [
    key,
    formText(value),
  ]);
  const body = new URLSearchParams(pairs).toString();
  return { body, contentType: FORM_CONTENT_TYPE };
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
function writePostBody(data: PostData, encoding: BodyEncoding = 'json'): IWrittenBody {
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

export { withBodyContentType, writePostBody };
