/**
 * Unit tests for NetworkResponseRecorder — persistent ring buffer + flushMatching.
 */

import * as fs from 'node:fs/promises';

import type { Page, Response } from 'playwright-core';
import * as tmp from 'tmp';

import { isSome } from '../../../../Scrapers/Pipeline/Types/Option.js';
import {
  findLatestMatch,
  flushMatching,
  type ICapturedResponse,
  installResponseBuffer,
  isBufferableBody,
  matchesPattern,
  MAX_BODY_BYTES,
  MAX_BUFFER_ENTRIES,
  toCommittableJson,
} from '../../../Integration/Tools/NetworkResponseRecorder.js';

/** Args used by {@link makeResponseStub} to fabricate a Playwright-shaped response. */
interface IResponseStubArgs {
  readonly url: string;
  readonly method: string;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

/** Request accessor implemented by response stubs. */
interface IStubRequestAccessor {
  readonly method: () => string;
}

/** Core response fields shared by all response stubs. */
interface IResponseCoreFields {
  readonly url: () => string;
  readonly status: () => number;
  readonly headers: () => Record<string, string>;
}

/** Body + request fields shared by all response stubs. */
interface IResponseBodyFields {
  readonly text: () => Promise<string>;
  readonly request: () => IStubRequestAccessor;
}

/** Complete response field map implemented by response stubs. */
interface IResponseStubFields extends IResponseCoreFields, IResponseBodyFields {}

/** Async response listener used by the page stub. */
type ResponseHandler = (response: Response) => Promise<void>;

/** Page-listener entry recorded by {@link makePageStub} for assertion. */
interface IListenerEntry {
  readonly event: string;
  readonly handler: ResponseHandler;
}

/** Stub returned by {@link makePageStub} exposing trigger + listener tracking. */
interface IPageStub {
  readonly page: Page;
  readonly listeners: IListenerEntry[];
  readonly trigger: (response: Response) => Promise<void>;
}

/** Status returned by page event stub callbacks. */
interface IEventHookStatus {
  readonly registered: true;
}

/** Page event callback implemented by the page stub. */
type PageEventCallback = (event: string, handler: ResponseHandler) => IEventHookStatus;

/** Page event methods implemented by {@link makePageStub}. */
interface IPageEventMethods {
  readonly on: PageEventCallback;
  readonly off: PageEventCallback;
}

/**
 * Build the request accessor sub-object for a response stub.
 *
 * @param method - HTTP method string to report.
 * @returns Plain object with a method() accessor.
 */
function makeRequestMethodAccessor(method: string): () => string {
  return (): string => method;
}

/**
 * Build the request accessor sub-object for a response stub.
 *
 * @param method - HTTP method string to report.
 * @returns Plain object with a method() accessor.
 */
function makeStubRequestAccessor(method: string): IStubRequestAccessor {
  const methodAccessor = makeRequestMethodAccessor(method);
  return { method: methodAccessor };
}

/**
 * Build a response URL accessor.
 * @param url - Response URL.
 * @returns URL accessor.
 */
function makeResponseUrlAccessor(url: string): () => string {
  return (): string => url;
}

/**
 * Build a response status accessor.
 * @param status - HTTP status code.
 * @returns Status accessor.
 */
function makeResponseStatusAccessor(status: number): () => number {
  return (): number => status;
}

/**
 * Build response headers accessor.
 * @param contentType - Response content type.
 * @returns Headers accessor.
 */
function makeResponseHeadersAccessor(contentType: string): () => Record<string, string> {
  return (): Record<string, string> => ({ 'content-type': contentType });
}

/**
 * Build shared URL/status/headers fields for a response stub.
 * @param url - Response URL.
 * @param status - HTTP status code.
 * @param contentType - Response content type.
 * @returns Core response field map.
 */
function buildStaticResponseCoreFields(
  url: string,
  status: number,
  contentType: string,
): IResponseCoreFields {
  const urlAccessor = makeResponseUrlAccessor(url);
  const statusAccessor = makeResponseStatusAccessor(status);
  const headers = makeResponseHeadersAccessor(contentType);
  return { url: urlAccessor, status: statusAccessor, headers };
}

/**
 * Build a resolved text accessor.
 * @param body - Body string returned by text().
 * @returns Text accessor.
 */
function makeResolvedTextAccessor(body: string): () => Promise<string> {
  return (): Promise<string> => Promise.resolve(body);
}

/**
 * Build the request accessor callback.
 * @param method - Request method returned by request().
 * @returns Request accessor callback.
 */
function makeRequestAccessorCallback(method: string): () => IStubRequestAccessor {
  return (): IStubRequestAccessor => makeStubRequestAccessor(method);
}

/**
 * Build resolving body fields for a response stub.
 * @param body - Body string returned by text().
 * @param method - Request method returned by request().
 * @returns Body + request field map.
 */
function buildResolvingBodyFields(body: string, method: string): IResponseBodyFields {
  const text = makeResolvedTextAccessor(body);
  const request = makeRequestAccessorCallback(method);
  return { text, request };
}

/**
 * Build the stub field map for a standard response stub.
 *
 * @param args - Fixture data the stub should report.
 * @returns Plain object with the harvester-used Response accessors.
 */
function buildResponseStubFields(args: IResponseStubArgs): IResponseStubFields {
  const core = buildStaticResponseCoreFields(args.url, args.status, args.contentType);
  const body = buildResolvingBodyFields(args.body, args.method);
  return { ...core, ...body };
}

/**
 * Build a Playwright {@link Response}-shaped stub with deterministic fields.
 *
 * @param args - Fixture data the stub should report.
 * @returns Stub typed as Playwright Response (only the harvester-used methods are implemented).
 */
function makeResponseStub(args: IResponseStubArgs): Response {
  return buildResponseStubFields(args) as unknown as Response;
}

/**
 * Build the stub fields for a failing response (text() rejects).
 *
 * @returns Plain object with URL/status/headers as constants and text() rejecting.
 */
function rejectFreedBody(): Promise<string> {
  const error = new Error('body freed');
  return Promise.reject(error);
}

/**
 * Build rejecting body fields for a response stub.
 * @param method - Request method returned by request().
 * @returns Body + request field map.
 */
function buildRejectingBodyFields(method: string): IResponseBodyFields {
  const request = makeRequestAccessorCallback(method);
  return { text: rejectFreedBody, request };
}

/**
 * Build the stub fields for a failing response (text() rejects).
 *
 * @returns Plain object with URL/status/headers as constants and text() rejecting.
 */
function buildFailingStubFields(): IResponseStubFields {
  const core = buildStaticResponseCoreFields('https://e.com/api/x', 200, 'application/json');
  const body = buildRejectingBodyFields('GET');
  return { ...core, ...body };
}

/**
 * Build a Playwright {@link Response}-shaped stub whose text() rejects.
 *
 * @returns Stub typed as Playwright Response (text() throws).
 */
function makeFailingResponseStub(): Response {
  return buildFailingStubFields() as unknown as Response;
}

/**
 * Build the stub fields for a slow response backed by a deferred body promise.
 *
 * @param bodyPromise - Promise that resolves to body text on demand.
 * @returns Plain object with the harvester-used Response accessors.
 */
function makeDeferredTextAccessor(bodyPromise: Promise<string>): () => Promise<string> {
  return (): Promise<string> => bodyPromise;
}

/**
 * Build slow body fields for a response stub.
 * @param bodyPromise - Promise that resolves to body text on demand.
 * @returns Body + request field map.
 */
function buildSlowBodyFields(bodyPromise: Promise<string>): IResponseBodyFields {
  const text = makeDeferredTextAccessor(bodyPromise);
  const request = makeRequestAccessorCallback('GET');
  return { text, request };
}

/**
 * Build the stub fields for a slow response backed by a deferred body promise.
 *
 * @param bodyPromise - Promise that resolves to body text on demand.
 * @returns Plain object with the harvester-used Response accessors.
 */
function buildSlowStubFields(bodyPromise: Promise<string>): IResponseStubFields {
  const core = buildStaticResponseCoreFields('https://e.com/api/slow', 200, 'application/json');
  const body = buildSlowBodyFields(bodyPromise);
  return { ...core, ...body };
}

/**
 * Build a Playwright {@link Response}-shaped stub whose text() awaits an
 * external promise. Used to model an in-flight body read so we can exercise
 * the drain race fix in {@link flushMatching}.
 *
 * @param bodyPromise - Promise that resolves to the body text on cue.
 * @returns Stub typed as Playwright Response with deferred body.
 */
function makeSlowResponseStub(bodyPromise: Promise<string>): Response {
  return buildSlowStubFields(bodyPromise) as unknown as Response;
}

/**
 * Build the on/off listener stub methods backed by a shared listener array.
 *
 * @param listeners - Mutable array to record registered listeners.
 * @returns Object with on + off event registration methods.
 */
function makePageOnCallback(listeners: IListenerEntry[]): PageEventCallback {
  return (event: string, handler: ResponseHandler): IEventHookStatus => {
    listeners.push({ event, handler });
    return { registered: true };
  };
}

/**
 * Build the page.off callback for the page stub.
 * @param listeners - Mutable listener ledger.
 * @returns off callback.
 */
function makePageOffCallback(listeners: IListenerEntry[]): PageEventCallback {
  return (event: string, handler: ResponseHandler): IEventHookStatus => {
    const idx = listeners.findIndex(l => l.event === event && l.handler === handler);
    if (idx >= 0) listeners.splice(idx, 1);
    return { registered: true };
  };
}

/**
 * Build the on/off listener stub methods backed by a shared listener array.
 *
 * @param listeners - Mutable array to record registered listeners.
 * @returns Object with on + off event registration methods.
 */
function buildPageEventMethods(listeners: IListenerEntry[]): IPageEventMethods {
  const on = makePageOnCallback(listeners);
  const off = makePageOffCallback(listeners);
  return { on, off };
}

/**
 * Build the trigger function that dispatches synthetic responses to listeners.
 *
 * @param listeners - Registered listener entries to dispatch to.
 * @returns Async trigger function.
 */
function buildTriggerFn(listeners: IListenerEntry[]): (response: Response) => Promise<void> {
  return async (response: Response): Promise<void> => {
    const calls = listeners.filter(l => l.event === 'response').map(l => l.handler(response));
    await Promise.all(calls);
  };
}

/**
 * Build a minimal Playwright {@link Page} stub that records `on`/`off` calls.
 *
 * @returns Stub plus a `trigger` helper that invokes registered response listeners.
 */
function makePageStub(): IPageStub {
  const listeners: IListenerEntry[] = [];
  const stub = buildPageEventMethods(listeners);
  const trigger = buildTriggerFn(listeners);
  return { page: stub as unknown as Page, listeners, trigger };
}

/**
 * Build the typed resolve callback for the deferred body pattern.
 *
 * @param slot - Single-element array holding the raw promise resolver.
 * @returns Typed resolver returning a status sentinel.
 */
function makeBodyResolver(
  slot: ((val: string) => unknown)[],
): (val: string) => IDeferredResolveStatus {
  return (val: string): IDeferredResolveStatus => {
    if (slot.length > 0) slot[0](val);
    return { resolved: true };
  };
}

/**
 * Build a baseline captured response with overridable fields.
 *
 * @param overrides - Partial overrides for the default fixture.
 * @returns Frozen capture suitable for matcher / serializer assertions.
 */
function makeCapture(overrides: Partial<ICapturedResponse> = {}): ICapturedResponse {
  const base: ICapturedResponse = {
    url: 'https://example.com/api/x',
    method: 'GET',
    status: 200,
    contentType: 'application/json; charset=utf-8',
    bodyText: '{"ok":true}',
  };
  return { ...base, ...overrides };
}

/** Status object returned by the deferred-body resolve hook. */
interface IDeferredResolveStatus {
  readonly resolved: true;
}

/** Pair of a pending Promise + a typed resolver suitable for the slow-body test. */
interface IDeferredBody {
  readonly bodyPromise: Promise<string>;
  readonly resolve: (val: string) => IDeferredResolveStatus;
}

/**
 * Create a deferred body promise paired with a typed resolver. Used to
 * model a Playwright response whose text() has not yet settled, so we
 * can exercise the {@link flushMatching} drain race fix.
 *
 * @returns Pair of bodyPromise + resolve helper.
 */
function createDeferredBody(): IDeferredBody {
  const slot: ((val: string) => unknown)[] = [];
  const bodyPromise = new Promise<string>(res => {
    slot.push(res);
  });
  return { bodyPromise, resolve: makeBodyResolver(slot) };
}

/**
 * Helper to create a secure per-test fixture directory using the `tmp`
 * library — the canonical fix CodeQL's `js/insecure-temporary-file`
 * (CWE-377/378) documentation recommends. `tmp.dirSync` creates the dir
 * with `0o700` mode and a cryptographically-random suffix, and
 * `unsafeCleanup: true` lets the per-test ``fs.rm`` succeed even when
 * the directory contains the response.json we just wrote.
 *
 * @returns Absolute path of the newly created temp dir (caller cleans up).
 */
function makeTmpDir(): string {
  const handle = tmp.dirSync({ prefix: 'nrr-', unsafeCleanup: true });
  return handle.name;
}

/**
 * Dispatch one synthetic response into a buffer via the stub trigger helper.
 *
 * @param stub - The page stub from {@link makePageStub}.
 * @param idx - Sequential index (used in URL + body for uniqueness).
 * @returns Promise resolved after listeners settle.
 */
async function pushOne(stub: IPageStub, idx: number): Promise<void> {
  const response = makeResponseStub({
    url: `https://e.com/api/${String(idx)}`,
    method: 'GET',
    status: 200,
    contentType: 'application/json',
    body: `{"i":${String(idx)}}`,
  });
  await stub.trigger(response);
}

describe('NetworkResponseRecorder', () => {
  describe('isBufferableBody', () => {
    it('returns true for small JSON bodies', () => {
      const isBuf = isBufferableBody('application/json', '{"a":1}');
      expect(isBuf).toBe(true);
    });

    it('returns true for application/<vendor>+json', () => {
      const isBuf = isBufferableBody('application/vnd.api+json', '{"a":1}');
      expect(isBuf).toBe(true);
    });

    it('returns false for HTML content-type', () => {
      const isBuf = isBufferableBody('text/html', '<html/>');
      expect(isBuf).toBe(false);
    });

    it('returns false for empty body', () => {
      const isBuf = isBufferableBody('application/json', '');
      expect(isBuf).toBe(false);
    });

    it('returns false for body exceeding MAX_BODY_BYTES', () => {
      const oversize = 'a'.repeat(MAX_BODY_BYTES + 1);
      const isBuf = isBufferableBody('application/json', oversize);
      expect(isBuf).toBe(false);
    });
  });

  describe('matchesPattern', () => {
    it('matches by URL substring when methods is undefined', () => {
      const entry = makeCapture({ url: 'https://example.com/api/cycle-billing' });
      const isMatch = matchesPattern(entry, '/cycle-billing');
      expect(isMatch).toBe(true);
    });

    it('rejects when URL substring missing', () => {
      const entry = makeCapture({ url: 'https://example.com/api/other' });
      const isMatch = matchesPattern(entry, '/cycle-billing');
      expect(isMatch).toBe(false);
    });

    it('matches only when method is in allow-list (case-insensitive)', () => {
      const entry = makeCapture({ method: 'POST' });
      const isMatch = matchesPattern(entry, '/api', ['post']);
      expect(isMatch).toBe(true);
    });

    it('rejects when method is not in allow-list', () => {
      const entry = makeCapture({ method: 'POST' });
      const isMatch = matchesPattern(entry, '/api', ['GET']);
      expect(isMatch).toBe(false);
    });

    it('treats empty methods array as no-filter', () => {
      const entry = makeCapture({ method: 'DELETE' });
      const isMatch = matchesPattern(entry, '/api', []);
      expect(isMatch).toBe(true);
    });
  });

  describe('findLatestMatch', () => {
    it('returns the latest matching entry (LIFO)', () => {
      const older = makeCapture({ url: 'https://e.com/api/cycle-billing?cycle=1' });
      const newer = makeCapture({ url: 'https://e.com/api/cycle-billing?cycle=2' });
      const snapshot: readonly ICapturedResponse[] = [older, newer];
      const opt = findLatestMatch(snapshot, '/cycle-billing');
      const isPresent = isSome(opt);
      expect(isPresent).toBe(true);
      if (isPresent) expect(opt.value).toBe(newer);
    });

    it('returns None when nothing matches', () => {
      const entry = makeCapture({ url: 'https://e.com/api/other' });
      const snapshot: readonly ICapturedResponse[] = [entry];
      const opt = findLatestMatch(snapshot, '/cycle-billing');
      const isPresent = isSome(opt);
      expect(isPresent).toBe(false);
    });
  });

  describe('toCommittableJson', () => {
    it('parses JSON body + redacts PII inside it', () => {
      const entry = makeCapture({
        url: 'https://api.example/scrape',
        bodyText: '{"email":"x@y.com","balance":"₪500.00"}',
      });
      const out = toCommittableJson(entry);
      expect(out).toContain('[redacted-email]');
      expect(out).toContain('[redacted-amount]');
      expect(out).toContain('"url": "https://api.example/scrape"');
    });

    it('falls back to bodyText wrapper when JSON.parse fails', () => {
      const entry = makeCapture({ bodyText: 'not-json-at-all' });
      const out = toCommittableJson(entry);
      expect(out).toContain('"bodyText": "not-json-at-all"');
    });
  });

  describe('installResponseBuffer', () => {
    it('captures one JSON response into the snapshot', async () => {
      const stub = makePageStub();
      const handle = installResponseBuffer(stub.page);
      const response = makeResponseStub({
        url: 'https://e.com/api/x',
        method: 'GET',
        status: 200,
        contentType: 'application/json',
        body: '{"a":1}',
      });
      await stub.trigger(response);
      const snapshot = handle.snapshot();
      expect(snapshot).toHaveLength(1);
      const first = snapshot[0];
      expect(first.url).toBe('https://e.com/api/x');
      expect(first.method).toBe('GET');
      expect(first.bodyText).toBe('{"a":1}');
    });

    it('skips non-JSON responses', async () => {
      const stub = makePageStub();
      const handle = installResponseBuffer(stub.page);
      const htmlResponse = makeResponseStub({
        url: 'https://e.com/page',
        method: 'GET',
        status: 200,
        contentType: 'text/html',
        body: '<html/>',
      });
      await stub.trigger(htmlResponse);
      const snapshot = handle.snapshot();
      expect(snapshot).toHaveLength(0);
    });

    it('evicts oldest entries when buffer exceeds MAX_BUFFER_ENTRIES', async () => {
      const stub = makePageStub();
      const handle = installResponseBuffer(stub.page);
      const total = MAX_BUFFER_ENTRIES + 5;
      const indices = Array.from({ length: total }, (_unused, i) => i);
      const dispatches = indices.map(i => pushOne(stub, i));
      await Promise.all(dispatches);
      const snapshot = handle.snapshot();
      expect(snapshot).toHaveLength(MAX_BUFFER_ENTRIES);
      const firstUrl = snapshot[0].url;
      expect(firstUrl).toBe('https://e.com/api/5');
    });

    it('dispose returns the disposed status and removes the listener', () => {
      const stub = makePageStub();
      const handle = installResponseBuffer(stub.page);
      const before = stub.listeners.length;
      expect(before).toBe(1);
      const status = handle.dispose();
      expect(status.disposed).toBe(true);
      const after = stub.listeners.length;
      expect(after).toBe(0);
    });

    it('quietly drops responses whose text() throws', async () => {
      const stub = makePageStub();
      const handle = installResponseBuffer(stub.page);
      const failing = makeFailingResponseStub();
      await stub.trigger(failing);
      const snapshot = handle.snapshot();
      expect(snapshot).toHaveLength(0);
    });
  });

  describe('flushMatching', () => {
    it('writes the matching response to disk and returns Some(path)', async () => {
      const stub = makePageStub();
      const handle = installResponseBuffer(stub.page);
      const response = makeResponseStub({
        url: 'https://e.com/api/cycle-billing',
        method: 'GET',
        status: 200,
        contentType: 'application/json',
        body: '{"cycle":42}',
      });
      await stub.trigger(response);
      const outDir = makeTmpDir();
      try {
        const opt = await flushMatching(handle, {
          urlPattern: '/cycle-billing',
          outDir,
          captureAs: 'cycle-billing',
        });
        const isPresent = isSome(opt);
        expect(isPresent).toBe(true);
        if (isPresent) {
          const written = await fs.readFile(opt.value, 'utf8');
          expect(written).toContain('"cycle": 42');
        }
      } finally {
        await fs.rm(outDir, { recursive: true, force: true });
      }
    });

    it('returns None when no buffered response matches', async () => {
      const stub = makePageStub();
      const handle = installResponseBuffer(stub.page);
      const outDir = makeTmpDir();
      try {
        const opt = await flushMatching(handle, {
          urlPattern: '/never-arrives',
          outDir,
          captureAs: 'x',
        });
        const isPresent = isSome(opt);
        expect(isPresent).toBe(false);
      } finally {
        await fs.rm(outDir, { recursive: true, force: true });
      }
    });

    it('drains in-flight captures before snapshotting (race-free)', async () => {
      const stub = makePageStub();
      const handle = installResponseBuffer(stub.page);
      const deferred = createDeferredBody();
      const slowResponse = makeSlowResponseStub(deferred.bodyPromise);
      const dispatched = stub.trigger(slowResponse);
      const outDir = makeTmpDir();
      try {
        const flushed = flushMatching(handle, {
          urlPattern: '/api/slow',
          outDir,
          captureAs: 'slow',
        });
        deferred.resolve('{"slow":true}');
        await dispatched;
        const opt = await flushed;
        const isPresent = isSome(opt);
        expect(isPresent).toBe(true);
        if (isPresent) {
          const written = await fs.readFile(opt.value, 'utf8');
          expect(written).toContain('"slow": true');
        }
      } finally {
        await fs.rm(outDir, { recursive: true, force: true });
      }
    });

    it('strips query + fragment from the captured URL before write', async () => {
      const stub = makePageStub();
      const handle = installResponseBuffer(stub.page);
      const response = makeResponseStub({
        url: 'https://e.com/api/account?accountId=secret-123&token=abc#frag',
        method: 'GET',
        status: 200,
        contentType: 'application/json',
        body: '{"ok":true}',
      });
      await stub.trigger(response);
      const outDir = makeTmpDir();
      try {
        const opt = await flushMatching(handle, {
          urlPattern: '/api/account',
          outDir,
          captureAs: 'acct',
        });
        const isPresent = isSome(opt);
        expect(isPresent).toBe(true);
        if (isPresent) {
          const written = await fs.readFile(opt.value, 'utf8');
          expect(written).toContain('"url": "https://e.com/api/account"');
          expect(written).not.toContain('secret-123');
          expect(written).not.toContain('token=abc');
          expect(written).not.toContain('#frag');
        }
      } finally {
        await fs.rm(outDir, { recursive: true, force: true });
      }
    });
  });
});
