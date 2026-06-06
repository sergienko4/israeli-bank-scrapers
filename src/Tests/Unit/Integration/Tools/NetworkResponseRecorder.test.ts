/**
 * Unit tests for NetworkResponseRecorder — persistent ring buffer + flushMatching.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Page, Response } from 'playwright-core';

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

/** Page-listener entry recorded by {@link makePageStub} for assertion. */
interface IListenerEntry {
  readonly event: string;
  readonly handler: (response: Response) => Promise<void>;
}

/** Stub returned by {@link makePageStub} exposing trigger + listener tracking. */
interface IPageStub {
  readonly page: Page;
  readonly listeners: IListenerEntry[];
  readonly trigger: (response: Response) => Promise<void>;
}

/**
 * Build a Playwright {@link Response}-shaped stub with deterministic fields.
 *
 * @param args - Fixture data the stub should report.
 * @returns Stub typed as Playwright Response (only the harvester-used methods are implemented).
 */
function makeResponseStub(args: IResponseStubArgs): Response {
  const stub = {
    /**
     * Captured request URL.
     * @returns URL string.
     */
    url: (): string => args.url,
    /**
     * Captured HTTP status.
     * @returns Status code.
     */
    status: (): number => args.status,
    /**
     * Response headers (content-type only).
     * @returns Single-header object.
     */
    headers: (): Record<string, string> => ({ 'content-type': args.contentType }),
    /**
     * Promise-resolved body text.
     * @returns The captured body.
     */
    text: (): Promise<string> => Promise.resolve(args.body),
    /**
     * Originating request stub exposing method().
     * @returns Request-shaped stub.
     */
    request: (): { method: () => string } => ({
      /**
       * Captured HTTP method.
       * @returns Method name (already upper-cased by harvester).
       */
      method: (): string => args.method,
    }),
  };
  return stub as unknown as Response;
}

/**
 * Build a Playwright {@link Response}-shaped stub whose text() rejects.
 *
 * @returns Stub typed as Playwright Response (text() throws).
 */
function makeFailingResponseStub(): Response {
  const stub = {
    /**
     * Captured request URL.
     * @returns URL string.
     */
    url: (): string => 'https://e.com/api/x',
    /**
     * Captured HTTP status.
     * @returns Status code.
     */
    status: (): number => 200,
    /**
     * Headers — JSON content-type so the buffer would otherwise accept.
     * @returns Single-header object.
     */
    headers: (): Record<string, string> => ({ 'content-type': 'application/json' }),
    /**
     * Body reader that always rejects, mimicking a freed response.
     * @returns Rejected promise.
     */
    text: (): Promise<string> => Promise.reject(new Error('body freed')),
    /**
     * Originating request stub exposing method().
     * @returns Request-shaped stub.
     */
    request: (): { method: () => string } => ({
      /**
       * Captured HTTP method.
       * @returns Method name.
       */
      method: (): string => 'GET',
    }),
  };
  return stub as unknown as Response;
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
  const stub = {
    /**
     * Captured request URL.
     * @returns URL string.
     */
    url: (): string => 'https://e.com/api/slow',
    /**
     * Captured HTTP status.
     * @returns Status code.
     */
    status: (): number => 200,
    /**
     * Headers — JSON content-type so the buffer accepts the response.
     * @returns Single-header object.
     */
    headers: (): Record<string, string> => ({ 'content-type': 'application/json' }),
    /**
     * Body reader that waits on the caller-supplied promise.
     * @returns Promise that resolves once the caller resolves bodyPromise.
     */
    text: (): Promise<string> => bodyPromise,
    /**
     * Originating request stub exposing method().
     * @returns Request-shaped stub.
     */
    request: (): { method: () => string } => ({
      /**
       * Captured HTTP method.
       * @returns Method name.
       */
      method: (): string => 'GET',
    }),
  };
  return stub as unknown as Response;
}

/**
 * Build a minimal Playwright {@link Page} stub that records `on`/`off` calls.
 *
 * @returns Stub plus a `trigger` helper that invokes registered response listeners.
 */
function makePageStub(): IPageStub {
  const listeners: IListenerEntry[] = [];
  const stub = {
    /**
     * Record a page event listener.
     * @param event - Event name ('response').
     * @param handler - Async response handler.
     * @returns The page stub (chainable).
     */
    on: (event: string, handler: (response: Response) => Promise<void>): unknown => {
      listeners.push({ event, handler });
      return stub;
    },
    /**
     * Remove a previously-registered listener.
     * @param event - Event name.
     * @param handler - Handler to remove.
     * @returns The page stub (chainable).
     */
    off: (event: string, handler: (response: Response) => Promise<void>): unknown => {
      const matchIdx = listeners.findIndex(l => l.event === event && l.handler === handler);
      if (matchIdx >= 0) listeners.splice(matchIdx, 1);
      return stub;
    },
  };
  /**
   * Dispatch a response to every registered 'response' listener.
   * @param response - The fabricated response to dispatch.
   * @returns Promise that resolves once all listeners settle.
   */
  const trigger = async (response: Response): Promise<void> => {
    const responseListeners = listeners.filter(l => l.event === 'response');
    const calls = responseListeners.map(l => l.handler(response));
    await Promise.all(calls);
  };
  return { page: stub as unknown as Page, listeners, trigger };
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
  type PromiseResolver = (val: string) => unknown;
  const slot: PromiseResolver[] = [];
  const bodyPromise = new Promise<string>(res => {
    slot.push(res);
  });
  /**
   * Settle the body promise with the supplied text once.
   * @param val - Body text to deliver downstream.
   * @returns Status sentinel confirming the resolver fired.
   */
  const resolve = (val: string): IDeferredResolveStatus => {
    if (slot.length > 0) slot[0](val);
    return { resolved: true };
  };
  return { bodyPromise, resolve };
}

/**
 * Helper to make a `tmpdir/nrr-<rand>` path for fixture write tests.
 *
 * @returns Absolute temp dir path (not yet created on disk).
 */
function makeTmpDir(): string {
  const rand = Math.random().toString(36).slice(2);
  const tmpRoot = os.tmpdir();
  return path.join(tmpRoot, `nrr-${rand}`);
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
      const opt = await flushMatching(handle, {
        urlPattern: '/never-arrives',
        outDir,
        captureAs: 'x',
      });
      const isPresent = isSome(opt);
      expect(isPresent).toBe(false);
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
