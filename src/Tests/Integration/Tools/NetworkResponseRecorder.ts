/**
 * Network response buffer for the harvester.
 *
 * <p>Installs a single `page.on('response')` listener that captures
 * every response into an in-memory ring buffer. Recipe steps later
 * call {@link flushMatching} to pull out specific responses and write
 * them to the bank's fixture directory (PII-redacted).
 *
 * <p>Design rationale: arming a listener PER step risks racing the
 * trigger action — once a response has been processed by the page,
 * a late `page.on('response')` listener never sees it. A persistent
 * buffer installed at recipe start eliminates that race.
 *
 * <p>Memory safety: only JSON-content responses are kept; bodies are
 * sized-capped to {@link MAX_BODY_BYTES} and the ring caps at
 * {@link MAX_BUFFER_ENTRIES} entries (oldest evicted on overflow).
 *
 * <p>PII safety: every body written to disk is run through
 * {@link redactJson}.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { Page, Response } from 'playwright-core';

import { none, type Option, some } from '../../../Scrapers/Pipeline/Types/Option.js';
import { redactJson } from './PiiRedactor.js';

const MAX_BUFFER_ENTRIES = 200;
const MAX_BODY_BYTES = 256 * 1024;
const JSON_CONTENT_RE = /^application\/(?:[\w.+-]+\+)?json\b/i;
const RESPONSE_LISTENER_EVENT = 'response' as const;
const FIXTURE_FILE_MODE = 0o600;
const FIXTURE_DIR_MODE = 0o700;

/** One captured response. */
interface ICapturedResponse {
  readonly url: string;
  readonly method: string;
  readonly status: number;
  readonly contentType: string;
  readonly bodyText: string;
}

/** Status object returned by the buffer dispose hook. */
interface IDisposeStatus {
  readonly disposed: true;
}

/** Status object returned after draining pending captures. */
interface IDrainStatus {
  readonly drained: true;
  readonly pendingAtStart: number;
}

/** Handle returned by {@link installResponseBuffer}. */
interface IResponseBufferHandle {
  readonly dispose: () => IDisposeStatus;
  readonly drain: () => Promise<IDrainStatus>;
  readonly snapshot: () => readonly ICapturedResponse[];
}

/** Arguments accepted by {@link flushMatching}. */
interface IFlushArgs {
  readonly urlPattern: string;
  readonly outDir: string;
  readonly captureAs: string;
  readonly methods?: readonly string[];
}

/**
 * Decide whether a response body is small + JSON enough to buffer.
 * @param contentType - Response `content-type` header.
 * @param bodyText - Stringified body.
 * @returns True if buffer-eligible.
 */
function isBufferableBody(contentType: string, bodyText: string): boolean {
  if (!JSON_CONTENT_RE.test(contentType)) return false;
  if (bodyText.length === 0) return false;
  return Buffer.byteLength(bodyText, 'utf8') <= MAX_BODY_BYTES;
}

/**
 * Safely read a response body. Returns `''` on any error — harvester
 * never throws on missing bodies (some responses have been freed by
 * the browser between event + read).
 * @param response - Playwright response.
 * @returns Body text or empty string.
 */
async function readBodyQuietly(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/** Result of pushing one capture into the ring buffer. */
interface IPushResult {
  readonly size: number;
}

/**
 * Append a capture to the ring buffer and evict overflow entries.
 * @param buffer - Mutable ring buffer.
 * @param entry - Captured response to push.
 * @returns Final buffer size after eviction.
 */
function pushAndEvict(buffer: ICapturedResponse[], entry: ICapturedResponse): IPushResult {
  buffer.push(entry);
  while (buffer.length > MAX_BUFFER_ENTRIES) buffer.shift();
  return { size: buffer.length };
}

/**
 * Extract the HTTP method from a Playwright response (upper-cased).
 *
 * @param response - Playwright response to inspect.
 * @returns Upper-cased HTTP method string.
 */
function capturedMethod(response: Response): string {
  return response.request().method().toUpperCase();
}

/** Args used by {@link buildCapture} to assemble an in-memory capture entry. */
interface IBuildCaptureArgs {
  readonly response: Response;
  readonly contentType: string;
  readonly bodyText: string;
}

/**
 * Build the in-memory capture entry for a Playwright response.
 * @param args - Response + content-type + already-read body text.
 * @returns Immutable capture entry.
 */
function buildCapture(args: IBuildCaptureArgs): ICapturedResponse {
  return {
    url: args.response.url(),
    method: capturedMethod(args.response),
    status: args.response.status(),
    contentType: args.contentType,
    bodyText: args.bodyText,
  };
}

/**
 * Pull one response into the buffer if it qualifies. Mutates the
 * provided buffer array; caller enforces ring eviction. Reads the
 * body ONLY after the content-type passes the JSON filter so we
 * skip the bandwidth/memory cost on HTML/binary responses.
 * @param response - Playwright response event.
 * @param buffer - Mutable ring buffer.
 * @returns Resolves when capture + eviction complete.
 */
async function captureOne(response: Response, buffer: ICapturedResponse[]): Promise<void> {
  const contentType = response.headers()['content-type'] ?? '';
  if (JSON_CONTENT_RE.test(contentType)) {
    const bodyText = await readBodyQuietly(response);
    if (isBufferableBody(contentType, bodyText)) {
      const entry = buildCapture({ response, contentType, bodyText });
      pushAndEvict(buffer, entry);
    }
  }
}

/** Async response listener type for the page event binding. */
type ResponseListener = (response: Response) => Promise<void>;

/** Parts needed to assemble an active response-buffer handle. */
interface IBufferHandleParts {
  readonly page: Page;
  readonly listener: ResponseListener;
  readonly pending: Set<Promise<void>>;
  readonly buffer: ICapturedResponse[];
}

/**
 * Build the page response listener that feeds the ring buffer.
 *
 * @param buffer - Mutable ring buffer to populate.
 * @param pending - Set of in-flight capture promises for drain tracking.
 * @returns Listener suitable for `page.on('response', ...)`.
 */
function makeResponseListener(
  buffer: ICapturedResponse[],
  pending: Set<Promise<void>>,
): ResponseListener {
  return (response: Response): Promise<void> => {
    const work = captureOne(response, buffer);
    pending.add(work);
    return work.finally(() => pending.delete(work));
  };
}

/**
 * Build the dispose callback that removes the listener from the page.
 *
 * @param page - Playwright page to unregister from.
 * @param listener - The listener to remove.
 * @returns Dispose function returning a status sentinel.
 */
function makeDisposeCallback(page: Page, listener: ResponseListener): () => IDisposeStatus {
  return (): IDisposeStatus => {
    page.off(RESPONSE_LISTENER_EVENT, listener);
    return { disposed: true };
  };
}

/**
 * Recursively drain the pending-captures set until empty. Avoids
 * `no-await-in-loop` by using recursion instead of a while-loop.
 *
 * @param pending - Live set of in-flight capture promises.
 * @param pendingAtStart - Size captured before first drain.
 * @returns Status object including the initial pending count.
 */
async function drainPending(
  pending: Set<Promise<void>>,
  pendingAtStart: number,
): Promise<IDrainStatus> {
  const snapshot = [...pending];
  if (snapshot.length === 0) return { drained: true, pendingAtStart };
  await Promise.allSettled(snapshot);
  return drainPending(pending, pendingAtStart);
}

/**
 * Build the drain callback for an active response buffer.
 * @param pending - Live set of in-flight capture promises.
 * @returns Drain callback.
 */
function makeDrainCallback(pending: Set<Promise<void>>): () => Promise<IDrainStatus> {
  return (): Promise<IDrainStatus> => drainPending(pending, pending.size);
}

/**
 * Build the non-mutating snapshot callback for the response buffer.
 * @param buffer - Captured response ring buffer.
 * @returns Snapshot callback.
 */
function makeSnapshotCallback(buffer: ICapturedResponse[]): () => readonly ICapturedResponse[] {
  return (): readonly ICapturedResponse[] => [...buffer];
}

/**
 * Assemble the active response-buffer handle.
 * @param parts - Components captured when installing the listener.
 * @returns Response-buffer handle.
 */
function buildResponseBufferHandle(parts: IBufferHandleParts): IResponseBufferHandle {
  const dispose = makeDisposeCallback(parts.page, parts.listener);
  const drain = makeDrainCallback(parts.pending);
  const snapshot = makeSnapshotCallback(parts.buffer);
  return { dispose, drain, snapshot };
}

/**
 * Install a persistent `page.on('response')` listener that fills a
 * shared ring buffer. The returned handle exposes a non-mutating
 * snapshot + a dispose that removes the listener + a drain that
 * settles every in-flight body read so `flushMatching` never races
 * a pending capture.
 * @param page - Playwright page.
 * @returns Handle for the active buffer.
 */
function installResponseBuffer(page: Page): IResponseBufferHandle {
  const buffer: ICapturedResponse[] = [];
  const pending = new Set<Promise<void>>();
  const listener = makeResponseListener(buffer, pending);
  page.on(RESPONSE_LISTENER_EVENT, listener);
  const parts: IBufferHandleParts = { page, listener, pending, buffer };
  return buildResponseBufferHandle(parts);
}

/**
 * Test if a captured response matches a recipe pattern.
 * @param entry - Captured response.
 * @param urlPattern - Substring to find in `entry.url`.
 * @param methods - Optional method allow-list (defaults to any).
 * @returns True if entry should be flushed for this pattern.
 */
function matchesPattern(
  entry: ICapturedResponse,
  urlPattern: string,
  methods?: readonly string[],
): boolean {
  if (!entry.url.includes(urlPattern)) return false;
  if (methods === undefined || methods.length === 0) return true;
  const upper = methods.map(m => m.toUpperCase());
  return upper.includes(entry.method);
}

/**
 * Search a snapshot array from the end for the first entry matching a predicate.
 *
 * @param snapshot - Array of captured responses (search is LIFO).
 * @param test - Predicate to evaluate each entry.
 * @returns Some(entry) for the latest match, otherwise none.
 */
function searchFromEnd(
  snapshot: readonly ICapturedResponse[],
  test: (e: ICapturedResponse) => boolean,
): Option<ICapturedResponse> {
  for (let i = snapshot.length - 1; i >= 0; i -= 1) {
    if (test(snapshot[i])) return some(snapshot[i]);
  }
  return none();
}

/**
 * Find the most recent matching entry in the buffer (LIFO so the
 * latest navigation's responses win when steps repeat).
 * @param snapshot - Snapshot from {@link IResponseBufferHandle.snapshot}.
 * @param urlPattern - URL substring.
 * @param methods - Optional method allow-list.
 * @returns Some(entry) for the latest match, otherwise none.
 */
function findLatestMatch(
  snapshot: readonly ICapturedResponse[],
  urlPattern: string,
  methods?: readonly string[],
): Option<ICapturedResponse> {
  return searchFromEnd(snapshot, e => matchesPattern(e, urlPattern, methods));
}

/**
 * Strip query + fragment from a captured response URL before it
 * lands on disk. Bank account ids, session tokens, and one-shot
 * grants live in the search portion — anything past `?` or `#` is
 * unsafe to commit verbatim. Falls back to the raw string if URL
 * parsing throws (which would mean the captured URL was already
 * malformed and not parseable upstream).
 * @param rawUrl - URL as captured by Playwright.
 * @returns URL stripped of search + fragment.
 */
function sanitizeCapturedUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Safely parse a JSON body, falling back to an object wrapper on failure.
 *
 * @param bodyText - Raw JSON string from the captured response.
 * @returns Parsed value or `{ bodyText }` sentinel on parse error.
 */
function parseBodySafely(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText);
  } catch {
    return { bodyText };
  }
}

/**
 * Build the PII-safe envelope object for disk serialization.
 *
 * @param entry - Captured response to serialize.
 * @param body - Already-parsed (and redaction-ready) body value.
 * @returns Plain object ready for `JSON.stringify` + redaction.
 */
function buildResponseEnvelope(entry: ICapturedResponse, body: unknown): Record<string, unknown> {
  return {
    url: sanitizeCapturedUrl(entry.url),
    method: entry.method,
    status: entry.status,
    contentType: entry.contentType,
    body,
  };
}

/**
 * Serialize a captured response to a JSON envelope safe to commit.
 * Body is JSON-parsed (best-effort) then redacted; on parse failure
 * the raw redacted string is preserved under `bodyText`. The URL is
 * stripped of query + hash before serialization so account ids and
 * session tokens never appear in committed fixtures.
 * @param entry - Captured response.
 * @returns Two-space JSON ready to write to disk.
 */
function toCommittableJson(entry: ICapturedResponse): string {
  const body = parseBodySafely(entry.bodyText);
  const envelope = buildResponseEnvelope(entry, body);
  return redactJson(envelope);
}

/**
 * Write one matched response JSON file at the given output path.
 *
 * @param outDir - Directory to write into (created if absent).
 * @param captureAs - Base filename (without extension).
 * @param payload - Redacted JSON string to write.
 * @returns Absolute path of the written file.
 */
async function writeMatchedResponse(
  outDir: string,
  captureAs: string,
  payload: string,
): Promise<string> {
  await fs.mkdir(outDir, { recursive: true, mode: FIXTURE_DIR_MODE });
  const outPath = path.join(outDir, `${captureAs}.response.json`);
  await fs.writeFile(outPath, payload, { encoding: 'utf8', mode: FIXTURE_FILE_MODE });
  return outPath;
}

/**
 * Find the latest match in a snapshot and write it to disk if present.
 *
 * @param snapshot - Immutable snapshot of the response buffer.
 * @param args - Pattern + output destination.
 * @returns Some(absolutePath) when written, otherwise none.
 */
async function writeIfMatched(
  snapshot: readonly ICapturedResponse[],
  args: IFlushArgs,
): Promise<Option<string>> {
  const match = findLatestMatch(snapshot, args.urlPattern, args.methods);
  if (!match.has) return none();
  const payload = toCommittableJson(match.value);
  const outPath = await writeMatchedResponse(args.outDir, args.captureAs, payload);
  return some(outPath);
}

/**
 * Locate one matching response in the live buffer + write it.
 * Returns `none()` when no match is found (caller decides whether to warn).
 * Drains in-flight captures FIRST so a response that began before the
 * navigation completed but hasn't finished `response.text()` yet is
 * still considered for the snapshot.
 *
 * Files are written with mode `0o600` (owner-only read/write) and any
 * directory we create is mode `0o700`. This satisfies CodeQL's
 * `js/insecure-temporary-file` (CWE-377/378) rule even when the caller
 * supplies a path that resolves under `os.tmpdir()` — fixtures must
 * never leak to other users on shared CI runners.
 * @param handle - Buffer handle from {@link installResponseBuffer}.
 * @param args - Pattern + output destination.
 * @returns Some(absolutePath) when written, otherwise none.
 */
async function flushMatching(
  handle: IResponseBufferHandle,
  args: IFlushArgs,
): Promise<Option<string>> {
  await handle.drain();
  const snapshot = handle.snapshot();
  return writeIfMatched(snapshot, args);
}

export type { ICapturedResponse, IDisposeStatus, IDrainStatus, IFlushArgs, IResponseBufferHandle };
export {
  findLatestMatch,
  flushMatching,
  installResponseBuffer,
  isBufferableBody,
  matchesPattern,
  MAX_BODY_BYTES,
  MAX_BUFFER_ENTRIES,
  toCommittableJson,
};
