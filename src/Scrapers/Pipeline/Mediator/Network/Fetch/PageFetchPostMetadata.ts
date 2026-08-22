/**
 * In-page POST that reports the transport facts alongside the body.
 *
 * A WAF challenge and an expired session both commonly arrive as a 200 carrying
 * HTML, or as a redirect to a login origin. Parsed as JSON both yield null —
 * the same value a genuinely empty result gives — so a caller of
 * {@link fetchPostWithinPage} cannot tell an authentication failure from an
 * account with no transactions, and keeps spending its budget against a session
 * that is already gone.
 *
 * Kept beside {@link fetchPostWithinPage} rather than folded into it for two
 * reasons. The return types stay honest: this one never collapses a failure
 * into `null`, which is the entire reason to call it. And the page function is
 * serialised into the browser, so it cannot call a shared helper — the two
 * paths could not have shared one even if the return types allowed it. The
 * evaluate-args object `fetchPostWithinPage` builds is therefore untouched.
 */

import type { Frame, Page } from 'playwright-core';

import { redactUrlFull } from '../../../Types/PiiRedactor.js';
import { logApiCall, logResponseIssues } from './Logging.js';
import { type IFetchPostOptions, withJsonContentType } from './PageFetchPost.js';

/** Options for {@link fetchPostWithinPageWithMetadata}. */
export interface IFetchPostWithMetadataOptions extends IFetchPostOptions {
  /**
   * Abort the in-page request after this many milliseconds.
   *
   * The browser `fetch` has no timeout of its own, so a provider that accepts
   * the connection and never answers stalls the whole scrape until the outer
   * per-run timeout fires — by which point the session is usually gone.
   * Omitted or non-positive means no timeout.
   */
  timeoutMs?: number;
}

/**
 * Transport-level facts about a response, independent of its body.
 *
 * These are the signals that distinguish "the provider returned no data" from
 * "we were bounced".
 */
export interface IResponseMetadata {
  status: number;
  contentType: string;
  redirected: boolean;
  /** False when the response came from a different origin than requested. */
  sameOrigin: boolean;
}

/** A response returned as transport metadata plus its body, if it parsed. */
export interface IPostWithMetadata {
  http: IResponseMetadata;
  /** Parsed JSON body, or null when the response was not usable JSON. */
  envelope: unknown;
}

/**
 * The plain-data half of the request, assembled on this side.
 *
 * No hardcoded headers: `headers` comes from {@link withJsonContentType} over
 * the caller's captured SPA headers, which stay the single source of truth for
 * Content-Type / Referer / X-XSRF-TOKEN / pageUuid / etc. — the same contract
 * `doPostFetch` documents in {@link ./PageFetchPost.js}.
 */
interface IMetadataPostInit {
  method: 'POST';
  body: string;
  credentials: 'include';
  headers: Record<string, string>;
}

/** Arguments handed across the page boundary. */
interface IMetadataEvaluateArgs {
  innerUrl: string;
  innerInit: IMetadataPostInit;
  innerTimeoutMs: number;
}

/** What the in-page fetch hands back. */
type MetadataTuple = readonly [
  text: string,
  status: number,
  contentType: string,
  redirected: boolean,
  finalUrl: string,
];

/**
 * POST inside the browser context, reporting the response's transport facts.
 *
 * Serialised into the page, so it may not reference anything outside its own
 * arguments — it cannot call a helper to shorten itself, which is why
 * everything that is plain data arrives pre-built in {@link IMetadataPostInit}.
 * The abort signal is the one part that cannot: it is a live object, not
 * serialisable data. `redirected` and the final URL are likewise read here
 * rather than inferred later — both are properties of the Response, and are
 * gone once only the body text has crossed back out.
 *
 * @param args - URL, pre-built init, and timeout.
 * @returns [text, status, contentType, redirected, finalUrl].
 */
async function doPostFetchWithMetadata(args: IMetadataEvaluateArgs): Promise<MetadataTuple> {
  const ms = args.innerTimeoutMs;
  const signal = ms > 0 ? AbortSignal.timeout(ms) : undefined;
  const response = await fetch(args.innerUrl, { ...args.innerInit, signal });
  const type = response.headers.get('content-type') ?? '';
  const text = response.status === 204 ? '' : await response.text();
  return [text, response.status, type, response.redirected, response.url] as const;
}

/**
 * Build the evaluate-args bundle for the metadata POST.
 *
 * @param url - Target URL.
 * @param opts - Public fetch options.
 * @returns Args ready for the page.
 */
function buildMetadataArgs(
  url: string,
  opts: IFetchPostWithMetadataOptions,
): IMetadataEvaluateArgs {
  const headers = withJsonContentType(opts.extraHeaders);
  const body = JSON.stringify(opts.data);
  const innerInit: IMetadataPostInit = { method: 'POST', body, credentials: 'include', headers };
  const innerTimeoutMs = opts.timeoutMs ?? 0;
  return { innerUrl: url, innerInit, innerTimeoutMs };
}

/**
 * True when a response is worth attempting to parse as JSON.
 *
 * A redirected response is excluded even at 2xx: landing on a login or
 * challenge origin is the single most common way a scrape "succeeds" while
 * returning nothing usable, and parsing it would erase that distinction.
 *
 * @param meta - Transport metadata for the response.
 * @returns True when the body should be parsed.
 */
function isParseableJson(meta: IResponseMetadata): boolean {
  if (meta.redirected) return false;
  if (meta.status < 200 || meta.status >= 300) return false;
  const lowered = meta.contentType.toLowerCase();
  return lowered.includes('application/json');
}

/**
 * Assemble the transport facts from what crossed back out of the page.
 *
 * @param result - Tuple returned by the in-page fetch.
 * @param url - The URL originally requested.
 * @returns Transport metadata for the response.
 */
function buildHttpMeta(result: MetadataTuple, url: string): IResponseMetadata {
  const [, status, contentType, isRedirected, finalUrl] = result;
  const finalOrigin = new URL(finalUrl).origin;
  const requestedOrigin = new URL(url).origin;
  const isSameOrigin = finalOrigin === requestedOrigin;
  return { status, contentType, redirected: isRedirected, sameOrigin: isSameOrigin };
}

/**
 * Pair the metadata with the body, parsed only where parsing is meaningful.
 *
 * 204 is answered before the JSON gate: it is a successful empty response and
 * servers routinely omit a content-type on it, so "succeeded with no content"
 * has to stay distinguishable from "could not be read" — which is the
 * distinction this whole module exists to preserve.
 *
 * @param http - Transport metadata for the response.
 * @param text - Raw response body.
 * @returns Metadata plus the parsed body, or a null body when unusable.
 */
function withEnvelope(http: IResponseMetadata, text: string): IPostWithMetadata {
  if (http.status === 204) return { http, envelope: {} };
  if (!isParseableJson(http)) return { http, envelope: null };
  if (text === '') return { http, envelope: {} };
  try {
    return { http, envelope: JSON.parse(text) };
  } catch {
    // A body that claimed JSON and was not is a transport-level anomaly, not a
    // parse error to raise: the metadata already records what happened.
    return { http, envelope: null };
  }
}

/** What was requested, and when — enough to log the call once it returns. */
interface ICall {
  url: string;
  startMs: number;
}

/**
 * Log the call, then pair its metadata with the body.
 *
 * @param result - Tuple returned by the in-page fetch.
 * @param call - The URL requested and the millisecond the call started.
 * @returns Transport metadata plus the parsed body.
 */
function finaliseMetadataPost(result: MetadataTuple, call: ICall): IPostWithMetadata {
  const [text, status] = result;
  const label = redactUrlFull(call.url).slice(-100);
  logApiCall(`POST(page) ${label}`, status, Date.now() - call.startMs);
  logResponseIssues(status, text, call.url);
  const http = buildHttpMeta(result, call.url);
  return withEnvelope(http, text);
}

/**
 * Perform a POST inside the page and return transport metadata alongside the
 * body, instead of the body alone.
 *
 * @param page - The Playwright page or frame context.
 * @param url - The URL to post to.
 * @param opts - Request body, optional extra headers, timeout.
 * @returns Transport metadata plus the parsed body, or a null body when the
 *   response was not usable JSON.
 */
export default async function fetchPostWithinPageWithMetadata(
  page: Page | Frame,
  url: string,
  opts: IFetchPostWithMetadataOptions,
): Promise<IPostWithMetadata> {
  const call = { url, startMs: Date.now() };
  const postArgs = buildMetadataArgs(url, opts);
  const result = await page.evaluate(doPostFetchWithMetadata, postArgs);
  return finaliseMetadataPost(result, call);
}
