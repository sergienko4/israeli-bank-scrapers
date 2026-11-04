/**
 * ApiPostData — the body a REST POST carries (N19): a JSON object, or a
 * top-level JSON array for an endpoint that takes a list (e.g. `[]`).
 * One name shared by the fetch strategies, the token bus, the API
 * mediator and the scrape shapes, so the widening stays in one place.
 */

import type { JsonUnknownRecord, JsonValue } from '../JsonValue.js';

/** A REST POST body: a JSON object, or a top-level JSON array. */
type ApiPostData = Readonly<JsonUnknownRecord> | readonly JsonValue[];

export type { ApiPostData };
