/**
 * HAR 1.2 type definitions — the subset Mode B simulator consumes.
 *
 * Source: <http://www.softwareishard.com/blog/har-12-spec/>
 *
 * Playwright's `recordHar` option emits HAR 1.2 JSON; this module
 * captures only the fields the simulator needs (URL/method/status/
 * headers/body + simple postData) and leaves out browser-specific
 * fields (pages timings, cache, headersSize, etc.) that aren't relevant
 * to replay semantics.
 *
 * Why a strict subset (not `any`):
 * `@typescript-eslint/no-explicit-any` is `error` in the repo, and
 * type-narrow parsing in {@link HarLoader} relies on these shapes.
 *
 * @see ./HarLoader.ts — parses + validates JSON to this shape.
 * @see ./StatefulRewriter.ts — picks the next entry for a request.
 */

/** A single HAR name/value pair (used for headers, queryString, cookies). */
interface IHarKeyValue {
  readonly name: string;
  readonly value: string;
}

/** HAR `request.postData` — request body when present. */
interface IHarPostData {
  readonly mimeType: string;
  readonly text: string;
}

/** HAR `request` — only the fields the simulator matches against. */
interface IHarRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: readonly IHarKeyValue[];
  readonly queryString: readonly IHarKeyValue[];
  readonly postData?: IHarPostData;
}

/** HAR `response.content` — body shape. */
interface IHarContent {
  readonly mimeType: string;
  readonly text?: string;
  /** Set to `'base64'` when `text` is base64-encoded binary. */
  readonly encoding?: 'base64';
}

/** HAR `response` — only the fields the simulator replays. */
interface IHarResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly IHarKeyValue[];
  readonly content: IHarContent;
}

/** HAR `log.entries[i]` — one request/response round-trip. */
interface IHarEntry {
  readonly request: IHarRequest;
  readonly response: IHarResponse;
}

/** HAR `log` — collection of entries. */
interface IHarLog {
  readonly version: string;
  readonly entries: readonly IHarEntry[];
}

/** Top-level HAR document — wraps `log`. */
interface IHarFile {
  readonly log: IHarLog;
}

export type {
  IHarContent,
  IHarEntry,
  IHarFile,
  IHarKeyValue,
  IHarLog,
  IHarPostData,
  IHarRequest,
  IHarResponse,
};
