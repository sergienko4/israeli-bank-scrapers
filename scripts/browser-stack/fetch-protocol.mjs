/**
 * Bounded HTTPS fetch for the browser-stack scripts.
 *
 * A policy names the reachable hosts, the body cap and any request headers.
 * The gate's policy, used by {@link fetchProtocol}, reaches only
 * `https://raw.githubusercontent.com` with a {@link MAX_BODY_BYTES} cap; the
 * weekly watch reads the GitHub and npm APIs under policies of its own.
 * Every hop, redirects included, must be HTTPS on a policy host. Each attempt
 * has a timeout; network errors (timeouts included), HTTP 5xx and HTTP 429
 * (rate limited) are retried with backoff, any other 4xx never is, and the
 * body is capped while it streams. Every failure is a
 * {@link FetchFailedError}, which the gate reports as infrastructure
 * (exit 2) — never as a pass.
 *
 * Camoufox has moved its source tree before, so the browser side is a list of
 * candidate URLs, newest layout first; only an HTTP 404 moves on to the next.
 *
 * Given a cache, {@link fetchProtocol} fetches each URL once: the weekly watch
 * passes one per run, so pairs that share a `Protocol.js` share its fetch and
 * its failure. The gate CLI passes none and fetches on every call.
 */
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * @typedef {import('./gate.d.mts').IFetchIo} IFetchIo
 * @typedef {import('./fetch-protocol.d.mts').IFetchPolicy} IFetchPolicy
 * @typedef {import('./fetch-protocol.d.mts').IFetchedBody} IFetchedBody
 * @typedef {Required<Omit<IFetchIo, 'cache'>> & { readonly policy: IFetchPolicy }} FetchIo
 *   - Fetch I/O, defaults and policy filled in.
 * @typedef {FetchIo & { readonly signal: AbortSignal }} AttemptIo - I/O of one attempt.
 */

/** The only host the gate may contact. */
export const ALLOWED_HOST = 'raw.githubusercontent.com';

/** Largest accepted body; upstream files are about 40 KiB. */
export const MAX_BODY_BYTES = 524_288;

/** Waits before the 2nd and 3rd attempt; its length + 1 is the attempt cap. */
export const BACKOFF_MS = Object.freeze([1000, 2000]);

/** Timeout of one attempt unless the caller sets `timeoutMs`. */
export const ATTEMPT_TIMEOUT_MS = 15_000;

const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** GitHub's rate-limit answer; it clears on its own, so it is retried like a 5xx. */
const RATE_LIMITED = 429;

/** Camoufox source roots, newest first: `browser/` wraps them from v156.0.1-beta.37. */
const CAMOUFOX_ROOTS = Object.freeze(['browser/additions', 'additions']);

/** Final, non-retryable failure reasons. */
const REASONS = Object.freeze({
  redirects: `redirected more than ${MAX_REDIRECTS} times`,
  size: (/** @type {number} */ maxBytes) => `body exceeds ${maxBytes} bytes`,
});

/** The gate's policy: raw GitHub files only, about 40 KiB each. */
const GATE_POLICY = Object.freeze({
  hosts: Object.freeze([ALLOWED_HOST]),
  maxBodyBytes: MAX_BODY_BYTES,
  headers: Object.freeze({}),
});

/** Production I/O; callers override any member. */
const DEFAULT_IO = Object.freeze({
  fetchImpl: (/** @type {string} */ url, /** @type {RequestInit} */ init) => fetch(url, init),
  sleep: (/** @type {number} */ ms) => delay(ms),
  timeoutMs: ATTEMPT_TIMEOUT_MS,
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

/** The URL when it is HTTPS on a policy host; throws otherwise. */
function allowed(/** @type {string} */ href, /** @type {readonly string[]} */ hosts) {
  const url = new URL(href);
  if (url.protocol === 'https:' && hosts.includes(url.host)) return url.href;
  throw new FetchFailedError(href, `is not allowlisted (only https://${hosts.join(', https://')})`);
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
  const { hosts, headers } = io.policy;
  /** @type {RequestInit} */
  const init = { redirect: 'manual', signal: io.signal, headers };
  const response = await io.fetchImpl(allowed(href, hosts), init);
  const location = locationOf(response);
  if (location === null) return response;
  await response.body?.cancel();
  if (hops === MAX_REDIRECTS) throw new FetchFailedError(href, REASONS.redirects);
  return follow(new URL(location, href).href, io, hops + 1);
}

/** Body bytes, refusing more than `maxBytes` while streaming. */
async function readCapped(
  /** @type {string} */ href,
  /** @type {Response} */ response,
  /** @type {number} */ maxBytes,
) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new FetchFailedError(href, REASONS.size(maxBytes));
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
    return { bytes: await readCapped(href, response, io.policy.maxBodyBytes) };
  } catch (error) {
    if (error instanceof FetchFailedError) return { failure: error, retry: false };
    return {
      failure: new FetchFailedError(href, networkReason(/** @type {NetworkFailure} */ (error), io)),
      retry: true,
    };
  }
}

/** @type {(bytes: Buffer) => IFetchedBody} */
const digest = bytes => ({
  text: bytes.toString('utf8'),
  sha256: createHash('sha256').update(bytes).digest('hex'),
});

/**
 * Fetch one body under `policy`.
 *
 * @param {string} href - Absolute HTTPS URL on a policy host.
 * @param {IFetchPolicy} policy - Reachable hosts, body cap and request headers.
 * @param {IFetchIo} [overrides] - Test I/O.
 * @returns {Promise<IFetchedBody>} Body text and the sha256 of its bytes.
 * @throws {FetchFailedError} When no attempt yields a body.
 */
export async function fetchBounded(href, policy, overrides = {}) {
  const io = { ...DEFAULT_IO, ...overrides, policy };
  for (let index = 0; ; index += 1) {
    const outcome = await attempt(href, io);
    if (outcome.bytes !== undefined) return digest(outcome.bytes);
    if (!outcome.retry || index === BACKOFF_MS.length) throw outcome.failure;
    await io.sleep(BACKOFF_MS[index]);
  }
}

/**
 * Fetch one schema under the gate's policy, once per URL when `overrides.cache` is given.
 *
 * A cached promise is returned whether it is pending, fulfilled or rejected,
 * so a failure is reused rather than retried; the retries are fetchBounded's.
 *
 * @param {string} href - Absolute URL on {@link ALLOWED_HOST}.
 * @param {IFetchIo} [overrides] - Test I/O, and the cache of one watch run.
 * @returns {Promise<IFetchedBody>} Body text and the sha256 of its bytes.
 * @throws {FetchFailedError} When no attempt yields a body.
 */
export function fetchProtocol(href, overrides = {}) {
  const cache = overrides.cache ?? new Map();
  const body = cache.get(href) ?? fetchBounded(href, GATE_POLICY, overrides);
  cache.set(href, body);
  return body;
}

/** @type {(error: unknown) => boolean} Whether a fetch failed with a final HTTP 404. */
const isNotFound = error => error instanceof FetchFailedError && error.status === 404;

/**
 * The first candidate that exists. Only a 404 moves on; any other failure is final.
 *
 * @param {string[]} hrefs - Candidate URLs, most likely first.
 * @param {IFetchIo} [overrides] - Test I/O, and the cache of one watch run.
 * @returns {Promise<IFetchedBody>} Body text and the sha256 of its bytes.
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
