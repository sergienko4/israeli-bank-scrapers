/**
 * Bounded HTTPS fetch of one Juggler `Protocol.js` for the browser-stack gate.
 *
 * Only `https://raw.githubusercontent.com` is reachable, redirect hops
 * included. Each attempt has a timeout; network errors (timeouts included),
 * HTTP 5xx and HTTP 429 (rate limited) are retried with backoff, any other
 * 4xx never is, and the body is capped while it streams. Every failure is a
 * {@link FetchFailedError}, which the gate reports as infrastructure
 * (exit 2) — never as a pass.
 *
 * Camoufox has moved its source tree before, so the browser side is a list of
 * candidate URLs, newest layout first; only an HTTP 404 moves on to the next.
 */
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * @typedef {import('./gate.d.mts').IFetchIo} IFetchIo
 * @typedef {Required<IFetchIo>} FetchIo - Fetch I/O, defaults filled in.
 * @typedef {FetchIo & { readonly signal: AbortSignal }} AttemptIo - I/O of one attempt.
 */

/** The only host the gate may contact. */
export const ALLOWED_HOST = 'raw.githubusercontent.com';

/** Largest accepted body; upstream files are about 40 KiB. */
export const MAX_BODY_BYTES = 524_288;

/** Waits before the 2nd and 3rd attempt; its length + 1 is the attempt cap. */
const BACKOFF_MS = Object.freeze([1000, 2000]);
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** GitHub's rate-limit answer; it clears on its own, so it is retried like a 5xx. */
const RATE_LIMITED = 429;

/** Camoufox source roots, newest first: `browser/` wraps them from v156.0.1-beta.37. */
const CAMOUFOX_ROOTS = Object.freeze(['browser/additions', 'additions']);

/** Final, non-retryable failure reasons. */
const REASONS = Object.freeze({
  redirects: `redirected more than ${MAX_REDIRECTS} times`,
  size: `body exceeds ${MAX_BODY_BYTES} bytes`,
});

/** Production I/O; callers override any member. */
const DEFAULT_IO = Object.freeze({
  fetchImpl: (/** @type {string} */ url, /** @type {RequestInit} */ init) => fetch(url, init),
  sleep: (/** @type {number} */ ms) => delay(ms),
  timeoutMs: 15_000,
});

/** A fetch that cannot yield a trustworthy body. */
export class FetchFailedError extends Error {
  /**
   * @param {string} url - URL that failed.
   * @param {string} reason - What went wrong.
   * @param {number} [status] - HTTP status of a final non-2xx answer, else 0.
   */
  constructor(url, reason, status = 0) {
    super(`${url} ${reason}`);
    this.name = 'FetchFailedError';
    this.status = status;
  }
}

/**
 * Raw URLs of the two schemas the gate compares.
 *
 * @param {string} playwright - playwright-core version, `x.y.z`.
 * @param {string} tag - Camoufox release tag.
 * @returns {{ client: string, browser: string[] }} Client URL; browser candidates, newest first.
 */
export function protocolUrls(playwright, tag) {
  const juggler = 'juggler/protocol/Protocol.js';
  const client = `microsoft/playwright/v${playwright}/browser_patches/firefox/${juggler}`;
  const browser = CAMOUFOX_ROOTS.map(root => `daijro/camoufox/${tag}/${root}/${juggler}`);
  return {
    client: `https://${ALLOWED_HOST}/${client}`,
    browser: browser.map(path => `https://${ALLOWED_HOST}/${path}`),
  };
}

/** The URL when it is HTTPS on the allowlisted host; throws otherwise. */
function allowed(/** @type {string} */ href) {
  const url = new URL(href);
  if (url.protocol === 'https:' && url.host === ALLOWED_HOST) return url.href;
  throw new FetchFailedError(href, `is not allowlisted (only https://${ALLOWED_HOST})`);
}

/** @type {(response: Response) => string | null} Location of a redirect, else null. */
const locationOf = response =>
  REDIRECT_STATUSES.has(response.status) ? response.headers.get('location') : null;

/**
 * First non-redirect response; every hop is checked against the allowlist before it is sent.
 *
 * @param {string} href - URL of this hop.
 * @param {AttemptIo} io - Fetch I/O, with the attempt's abort signal.
 * @param {number} hops - Redirects followed so far.
 * @returns {Promise<Response>} The final response.
 */
async function follow(href, io, hops) {
  const response = await io.fetchImpl(allowed(href), { redirect: 'manual', signal: io.signal });
  const location = locationOf(response);
  if (location === null) return response;
  await response.body?.cancel();
  if (hops === MAX_REDIRECTS) throw new FetchFailedError(href, REASONS.redirects);
  return follow(new URL(location, href).href, io, hops + 1);
}

/** Body bytes, refusing more than {@link MAX_BODY_BYTES} while streaming. */
async function readCapped(/** @type {string} */ href, /** @type {Response} */ response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) throw new FetchFailedError(href, REASONS.size);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * What a failed attempt threw, as far as {@link networkReason} reads it — defensively,
 * with `?.`: a `TimeoutError` DOMException, or a `TypeError` whose `cause` has a code.
 *
 * @typedef {object} NetworkFailure
 * @property {string} [name] - `TimeoutError` when the attempt's signal fired.
 * @property {string} [message] - What went wrong.
 * @property {{ code?: string }} [cause] - Underlying system error, e.g. `ECONNRESET`.
 */

/** @type {(error: NetworkFailure, io: FetchIo) => string} Reason of a network-level failure. */
const networkReason = (error, io) =>
  error?.name === 'TimeoutError'
    ? `timed out after ${io.timeoutMs} ms`
    : `network error (${String(error?.cause?.code ?? error?.message ?? error)})`;

/** A non-2xx answer: 5xx and 429 may be transient, anything else is final. */
async function statusFailure(/** @type {string} */ href, /** @type {Response} */ response) {
  await response.body?.cancel();
  const failure = new FetchFailedError(href, `HTTP ${response.status}`, response.status);
  return { failure, retry: response.status >= 500 || response.status === RATE_LIMITED };
}

/**
 * Outcome of one attempt: the body, or a failure and whether it may be retried.
 *
 * @typedef {{ bytes: Buffer, failure?: undefined, retry?: undefined }} AttemptBody
 * @typedef {{ bytes?: undefined, failure: FetchFailedError, retry: boolean }} AttemptFailure
 */

/** @returns {Promise<AttemptBody | AttemptFailure>} `{ bytes }`, or `{ failure, retry }`. */
async function attempt(/** @type {string} */ href, /** @type {FetchIo} */ io) {
  try {
    const response = await follow(href, { ...io, signal: AbortSignal.timeout(io.timeoutMs) }, 0);
    if (!response.ok) return await statusFailure(href, response);
    return { bytes: await readCapped(href, response) };
  } catch (error) {
    if (error instanceof FetchFailedError) return { failure: error, retry: false };
    return {
      failure: new FetchFailedError(href, networkReason(/** @type {NetworkFailure} */ (error), io)),
      retry: true,
    };
  }
}

/** @type {(bytes: Buffer) => { text: string, sha256: string }} */
const digest = bytes => ({
  text: bytes.toString('utf8'),
  sha256: createHash('sha256').update(bytes).digest('hex'),
});

/**
 * Fetch one schema under the gate's policy.
 *
 * @param {string} href - Absolute URL on {@link ALLOWED_HOST}.
 * @param {IFetchIo} [overrides] - Test I/O.
 * @returns {Promise<{ text: string, sha256: string }>} Body text and the sha256 of its bytes.
 * @throws {FetchFailedError} When no attempt yields a body.
 */
export async function fetchProtocol(href, overrides = {}) {
  const io = { ...DEFAULT_IO, ...overrides };
  for (let index = 0; ; index += 1) {
    const outcome = await attempt(href, io);
    if (outcome.bytes !== undefined) return digest(outcome.bytes);
    if (!outcome.retry || index === BACKOFF_MS.length) throw outcome.failure;
    await io.sleep(BACKOFF_MS[index]);
  }
}

/** @type {(error: unknown) => boolean} Whether a fetch failed with a final HTTP 404. */
const isNotFound = error => error instanceof FetchFailedError && error.status === 404;

/**
 * The first candidate that exists. Only a 404 moves on; any other failure is final.
 *
 * @param {string[]} hrefs - Candidate URLs, most likely first.
 * @param {IFetchIo} [overrides] - Test I/O.
 * @returns {Promise<{ text: string, sha256: string }>} Body text and the sha256 of its bytes.
 * @throws {FetchFailedError} On a non-404 failure, or a 404 at every candidate.
 */
export async function fetchFirst(hrefs, overrides = {}) {
  for (const href of hrefs) {
    try {
      return await fetchProtocol(href, overrides);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  throw new FetchFailedError(hrefs.join(' | '), 'HTTP 404', 404);
}
