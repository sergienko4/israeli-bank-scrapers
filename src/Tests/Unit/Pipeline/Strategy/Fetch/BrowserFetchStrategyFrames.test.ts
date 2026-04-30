/**
 * Unit tests for BrowserFetchStrategy — frame matching + empty response branches.
 * Split from BrowserFetchStrategy.test.ts to honor max-lines=300.
 */

import type { Page } from 'playwright-core';

import { createBrowserFetchStrategy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/BrowserFetchStrategy.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Local test error for rejecting with a non-Error class (PII-safe). */
class TestError extends Error {
  /**
   * Build TestError with message.
   * @param message - Error message.
   */
  constructor(message: string) {
    super(message);
    this.name = 'TestError';
  }
}

/** Bank config type pulled via IFetchStrategy parameter shape. */
type BankConfigStub = Parameters<
  NonNullable<ReturnType<typeof createBrowserFetchStrategy>['proxyGet']>
>[0];

/** Scripted response for a mocked page.evaluate (POST/GET). */
type EvalTuple = readonly [string, number];

/** Result returned by the mocked APIRequestContext. */
interface IMockApiResponse {
  readonly status: number;
  readonly body: string;
}

/** Recorder for cross-origin fall-through assertions. */
interface IContextRequestRecorder {
  postCalls: number;
  getCalls: number;
  lastUrl: string;
  lastHeaders: Record<string, string>;
}

/**
 * Build a Page whose evaluate returns scripted tuples in order, with a
 * mocked BrowserContext.request that records calls and returns a
 * configurable APIResponse. Tests use the recorder to assert the
 * cross-origin fall-through path was taken.
 * @param config - Tuples + URL + frames + optional API response.
 * @returns Scripted Page.
 */
interface IScriptedPageConfig {
  readonly tuples: readonly EvalTuple[];
  readonly urlValue?: string;
  readonly frames?: Page[];
  readonly apiResponse?: IMockApiResponse;
  readonly recorder?: IContextRequestRecorder;
}

/** Stub Playwright APIResponse — exposes status() + text(). */
interface IFakeApiResponse {
  status: () => number;
  text: () => Promise<string>;
}

/** Stub APIRequestContext — POST/GET methods that record + reply. */
interface IFakeApiCtx {
  post: (
    targetUrl: string,
    opts: { headers?: Record<string, string> },
  ) => Promise<IFakeApiResponse>;
  get: (targetUrl: string, opts: { headers?: Record<string, string> }) => Promise<IFakeApiResponse>;
}

/**
 * Build a Page whose evaluate returns scripted tuples in order, with a
 * mocked BrowserContext.request that records calls and returns a
 * configurable APIResponse. Tests use the recorder to assert the
 * cross-origin fall-through path was taken.
 * @param config - Tuples + URL + frames + optional API response + recorder.
 * @returns Scripted Page.
 */
function makeScriptedPage(config: IScriptedPageConfig): Page {
  const tuples = config.tuples;
  const urlValue = config.urlValue ?? 'https://api.example/';
  const frames = config.frames ?? [];
  const apiResponse = config.apiResponse ?? { status: 200, body: '{}' };
  const recorder = config.recorder;
  let idx = 0;
  /**
   * Build a fake APIResponse that mirrors the Playwright shape.
   * @returns Stub API response with status() + text().
   */
  const makeApiResponse = (): IFakeApiResponse => ({
    /**
     * Stub status getter.
     * @returns Scripted HTTP status.
     */
    status: (): number => apiResponse.status,
    /**
     * Stub body getter.
     * @returns Scripted body text wrapped in a Promise.
     */
    text: (): Promise<string> => Promise.resolve(apiResponse.body),
  });
  /** Mocked BrowserContext.request — records calls + returns scripted body. */
  const apiCtx: IFakeApiCtx = {
    /**
     * Mocked POST.
     * @param targetUrl - Target URL.
     * @param opts - Bundle of headers.
     * @param opts.headers - Request headers (Origin/Referer/Content-Type).
     * @returns Scripted APIResponse.
     */
    post: (
      targetUrl: string,
      opts: { headers?: Record<string, string> },
    ): Promise<IFakeApiResponse> => {
      if (recorder) {
        recorder.postCalls += 1;
        recorder.lastUrl = targetUrl;
        recorder.lastHeaders = opts.headers ?? {};
      }
      const apiResp = makeApiResponse();
      return Promise.resolve(apiResp);
    },
    /**
     * Mocked GET.
     * @param targetUrl - Target URL.
     * @param opts - Bundle of headers.
     * @param opts.headers - Request headers (Origin/Referer/Accept).
     * @returns Scripted APIResponse.
     */
    get: (
      targetUrl: string,
      opts: { headers?: Record<string, string> },
    ): Promise<IFakeApiResponse> => {
      if (recorder) {
        recorder.getCalls += 1;
        recorder.lastUrl = targetUrl;
        recorder.lastHeaders = opts.headers ?? {};
      }
      const apiResp = makeApiResponse();
      return Promise.resolve(apiResp);
    },
  };
  return {
    /**
     * Page URL stub.
     * @returns Configured URL.
     */
    url: (): string => urlValue,
    /**
     * Frames stub.
     * @returns Configured frames.
     */
    frames: (): Page[] => frames,
    /**
     * Evaluate stub — returns scripted tuples in order.
     * @returns Scripted tuple or rejection when exhausted.
     */
    evaluate: (): Promise<EvalTuple> => {
      if (idx >= tuples.length) return Promise.reject(new Error('no-more-scripted-responses'));
      const current = tuples[idx];
      idx += 1;
      return Promise.resolve(current);
    },
    /**
     * BrowserContext stub — exposes a mocked APIRequestContext for the
     * cross-origin fall-through path tests.
     * @returns Stub context with .request.
     */
    context: (): { request: typeof apiCtx } => ({ request: apiCtx }),
  } as unknown as Page;
}

describe('BrowserFetchStrategy — resolveContext frame matching', () => {
  it('uses page when target origin matches page origin', async () => {
    const page = makeScriptedPage({ tuples: [['{}', 200]], urlValue: 'https://api.example/' });
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://api.example/data', { extraHeaders: {} });
    const isOkResult17 = isOk(result);
    expect(isOkResult17).toBe(true);
  });

  it('falls through to BrowserContext.request when no frame matches origin', async () => {
    // The page is on a sibling origin and no iframe matches the target —
    // mirrors the Isracard CI failure pattern (page parked on
    // marketing.* while the activation API targets digital.*).
    // resolveContext returns fail; the caller routes to context.request,
    // which carries cookies regardless of page URL. The recorder
    // confirms the fall-through path actually fired.
    const recorder: IContextRequestRecorder = {
      postCalls: 0,
      getCalls: 0,
      lastUrl: '',
      lastHeaders: {},
    };
    const page = makeScriptedPage({
      tuples: [['{}', 200]],
      urlValue: 'https://page.example/',
      apiResponse: { status: 200, body: '{"ok":true}' },
      recorder,
    });
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://api.other.com/data', { extraHeaders: {} });
    const isOkay = isOk(result);
    expect(isOkay).toBe(true);
    expect(recorder.getCalls).toBe(1);
    expect(recorder.lastUrl).toBe('https://api.other.com/data');
    expect(recorder.lastHeaders.Origin).toBe('https://api.other.com');
  });

  it('falls through to context.request when only about:blank frame is present', async () => {
    const blankFrame = {
      /**
       * Frame URL stub.
       * @returns about:blank.
       */
      url: (): string => 'about:blank',
      /**
       * Evaluate stub — should never be called.
       * @returns Scripted tuple.
       */
      evaluate: (): Promise<EvalTuple> => Promise.resolve(['{}', 200] as EvalTuple),
    } as unknown as Page;
    const recorder: IContextRequestRecorder = {
      postCalls: 0,
      getCalls: 0,
      lastUrl: '',
      lastHeaders: {},
    };
    const page = makeScriptedPage({
      tuples: [['{}', 200]],
      urlValue: 'https://page.example/',
      frames: [blankFrame],
      apiResponse: { status: 200, body: '{"ok":true}' },
      recorder,
    });
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://api.other.com/data', { extraHeaders: {} });
    const isOkay = isOk(result);
    expect(isOkay).toBe(true);
    expect(recorder.getCalls).toBe(1);
  });

  it('falls through to context.request when only empty-url frame is present', async () => {
    const emptyFrame = {
      /**
       * Frame URL stub.
       * @returns Empty string.
       */
      url: (): string => '',
      /**
       * Evaluate stub — should never be called.
       * @returns Scripted tuple.
       */
      evaluate: (): Promise<EvalTuple> => Promise.resolve(['{}', 200] as EvalTuple),
    } as unknown as Page;
    const recorder: IContextRequestRecorder = {
      postCalls: 0,
      getCalls: 0,
      lastUrl: '',
      lastHeaders: {},
    };
    const page = makeScriptedPage({
      tuples: [['{}', 200]],
      urlValue: 'https://page.example/',
      frames: [emptyFrame],
      apiResponse: { status: 200, body: '{"ok":true}' },
      recorder,
    });
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://api.other.com/data', { extraHeaders: {} });
    const isOkay = isOk(result);
    expect(isOkay).toBe(true);
    expect(recorder.getCalls).toBe(1);
  });

  it('uses matching frame when origin aligns (no fall-through)', async () => {
    let didMatchFrame = false;
    const apiFrame = {
      /**
       * Frame URL stub.
       * @returns Matching origin URL.
       */
      url: (): string => 'https://api.other.com/inner',
      /**
       * Evaluate stub — records match.
       * @returns Scripted tuple.
       */
      evaluate: (): Promise<EvalTuple> => {
        didMatchFrame = true;
        return Promise.resolve(['{}', 200] as EvalTuple);
      },
    } as unknown as Page;
    const recorder: IContextRequestRecorder = {
      postCalls: 0,
      getCalls: 0,
      lastUrl: '',
      lastHeaders: {},
    };
    const page = makeScriptedPage({
      tuples: [['{}', 200]],
      urlValue: 'https://page.example/',
      frames: [apiFrame],
      recorder,
    });
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://api.other.com/data', { extraHeaders: {} });
    const isOkay = isOk(result);
    expect(isOkay).toBe(true);
    expect(didMatchFrame).toBe(true);
    // Same-origin match — fall-through must NOT fire.
    expect(recorder.getCalls).toBe(0);
  });

  it('falls through fails on non-2xx context.request status', async () => {
    const recorder: IContextRequestRecorder = {
      postCalls: 0,
      getCalls: 0,
      lastUrl: '',
      lastHeaders: {},
    };
    const page = makeScriptedPage({
      tuples: [['{}', 200]],
      urlValue: 'https://page.example/',
      apiResponse: { status: 500, body: '<html>error</html>' },
      recorder,
    });
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://api.other.com/data', { extraHeaders: {} });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('status=500');
  });
});

describe('BrowserFetchStrategy — empty response handling', () => {
  it('fetchPost returns empty-response failure when fetch yields empty/null result', async () => {
    const page = makeScriptedPage({ tuples: [['null', 200]] });
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchPost(
      'https://api.example/x',
      { k: 'v' },
      { extraHeaders: {} },
    );
    const isOkResult22 = isOk(result);
    expect(isOkResult22).toBe(false);
  });

  it('fetchGet-with-headers returns empty-response failure for null body', async () => {
    const page = makeScriptedPage({ tuples: [['null', 200]] });
    const strategy = createBrowserFetchStrategy(page);
    const result = await strategy.fetchGet('https://api.example/x', {
      extraHeaders: { 'X-Auth': 'xyz' },
    });
    const isOkResult23 = isOk(result);
    expect(isOkResult23).toBe(false);
  });

  it('proxyGet returns empty-response failure on null response body', async () => {
    const page = makeScriptedPage({ tuples: [['null', 200]] });
    const strategy = createBrowserFetchStrategy(page);
    const config = {
      urls: { base: 'https://b.example' },
      api: { base: 'https://api.example' },
    } as unknown as BankConfigStub;
    if (!strategy.proxyGet) throw new TestError('proxyGet missing');
    const result = await strategy.proxyGet(config, 'ReqX', { k: 'v' });
    const isOkResult24 = isOk(result);
    expect(isOkResult24).toBe(false);
  });

  it('proxyGet succeeds when response body is non-null JSON', async () => {
    const page = makeScriptedPage({ tuples: [[JSON.stringify({ data: 'ok' }), 200]] });
    const strategy = createBrowserFetchStrategy(page);
    const config = {
      urls: { base: 'https://b.example' },
      api: { base: 'https://api.example' },
    } as unknown as BankConfigStub;
    if (!strategy.proxyGet) throw new TestError('proxyGet missing');
    const result = await strategy.proxyGet(config, 'ReqX', { k: 'v', a: 'b' });
    const isOkResult25 = isOk(result);
    expect(isOkResult25).toBe(true);
  });
});
