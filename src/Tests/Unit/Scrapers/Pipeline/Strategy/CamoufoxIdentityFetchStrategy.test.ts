/**
 * Unit tests for CamoufoxIdentityFetchStrategy. Mocks @hieutran094/camoufox-js
 * so launch returns a fake browser whose page.evaluate() is controlled
 * per-test via a shared envelope fixture.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Envelope returned by the in-page fetch wrapper. */
interface IPageFetchEnvelope {
  readonly ok: boolean;
  readonly status: number;
  readonly bodyText: string;
  readonly setCookies: readonly string[];
}

/** Per-test launch + fetch behaviour controlled by the shared state. */
interface IMockState {
  envelope: IPageFetchEnvelope;
  launchThrows: boolean;
  navThrows: boolean;
  evaluateThrows: boolean;
  evaluateRunsCallback: boolean;
  closeThrows: boolean;
  closeCalls: number;
  pageGotos: string[];
  launchCalls: number;
}

const ENV_OK_DEFAULT: IPageFetchEnvelope = {
  ok: true,
  status: 200,
  bodyText: '{"ok":true}',
  setCookies: [],
};
const STATE: IMockState = {
  envelope: ENV_OK_DEFAULT,
  launchThrows: false,
  navThrows: false,
  evaluateThrows: false,
  evaluateRunsCallback: false,
  closeThrows: false,
  closeCalls: 0,
  pageGotos: [],
  launchCalls: 0,
};

/**
 * Resets the shared mock state to default success behaviour.
 * @returns True once reset.
 */
function resetState(): boolean {
  Object.assign(STATE, {
    envelope: ENV_OK_DEFAULT,
    launchThrows: false,
    navThrows: false,
    evaluateThrows: false,
    evaluateRunsCallback: false,
    closeThrows: false,
    closeCalls: 0,
    pageGotos: [],
    launchCalls: 0,
  });
  return true;
}

/**
 * Builds the mock fake browser tree returned by the Camoufox factory.
 * @returns Fake browser exposing newContext + close.
 */
function buildMockBrowser(): unknown {
  /**
   * Mock page.goto. Records URL or rejects on navThrows.
   * @param url - Target URL.
   * @returns Resolves null.
   */
  const goto = (url: string): Promise<unknown> => {
    STATE.pageGotos.push(url);
    if (STATE.navThrows) return Promise.reject(new Error('nav failed'));
    return Promise.resolve(null);
  };
  /** Args bundle that mirrors the strategy's IInPageFetchArgs. */
  type EvaluateCallback = (args: unknown) => Promise<IPageFetchEnvelope>;
  /**
   * Mock page.evaluate — returns STATE.envelope, rejects on evaluateThrows,
   * or executes the supplied callback against the test's global fetch stub
   * when evaluateRunsCallback is enabled (covers the in-page fetch wrapper).
   * @param fn - Callback the production code passes to page.evaluate.
   * @param args - Arguments forwarded to the callback.
   * @returns Resolved envelope.
   */
  const evaluatePage = (fn?: EvaluateCallback, args?: unknown): Promise<IPageFetchEnvelope> => {
    if (STATE.evaluateThrows) return Promise.reject(new Error('evaluate-boom'));
    if (STATE.evaluateRunsCallback && typeof fn === 'function') return fn(args);
    return Promise.resolve(STATE.envelope);
  };
  const page = { goto, evaluate: evaluatePage };
  /**
   * Mock newPage.
   * @returns Resolved mock page.
   */
  const newPage = (): Promise<typeof page> => Promise.resolve(page);
  /**
   * Mock newContext.
   * @returns Resolved mock context.
   */
  const newContext = (): Promise<{ newPage: typeof newPage }> => Promise.resolve({ newPage });
  /**
   * Mock browser.close. Increments STATE.closeCalls; rejects on closeThrows.
   * @returns Resolved void.
   */
  const close = (): Promise<void> => {
    STATE.closeCalls += 1;
    if (STATE.closeThrows) return Promise.reject(new Error('close-boom'));
    return Promise.resolve();
  };
  return { newContext, close };
}

/**
 * Mock Camoufox launcher returning a fake Browser/Context/Page tree.
 * @returns Fake browser whose page.evaluate replies from STATE.envelope.
 */
function camoufoxFactory(): Promise<unknown> {
  STATE.launchCalls += 1;
  if (STATE.launchThrows) {
    const launchError = new Error('binary missing');
    return Promise.reject(launchError);
  }
  const fakeBrowser = buildMockBrowser();
  return Promise.resolve(fakeBrowser);
}

jest.unstable_mockModule('@hieutran094/camoufox-js', () => ({ Camoufox: camoufoxFactory }));

const STRATEGY_MOD =
  await import('../../../../../Scrapers/Pipeline/Strategy/Fetch/CamoufoxIdentityFetchStrategy.js');
const { CamoufoxIdentityFetchStrategy: STRATEGY } = STRATEGY_MOD;

const ORIGIN = 'https://identity.tfd-bank.com';
const URL_OK = 'https://identity.tfd-bank.com/v1/devices/token';
const OPTS = { extraHeaders: {} };
const ENV_OK: IPageFetchEnvelope = {
  ok: true,
  status: 200,
  bodyText: '{"deviceToken":"jwt"}',
  setCookies: ['sid=abc'],
};
const ENV_CF_OLDIE: IPageFetchEnvelope = {
  ok: false,
  status: 403,
  bodyText: '<html class="ie6 oldie">',
  setCookies: [],
};
const ENV_CF_ERROR: IPageFetchEnvelope = {
  ok: false,
  status: 403,
  bodyText: '<html class="cf-error">',
  setCookies: [],
};
const ENV_APP_400: IPageFetchEnvelope = {
  ok: false,
  status: 400,
  bodyText: '{"error":"bad request"}',
  setCookies: [],
};

beforeEach(() => {
  resetState();
});

describe('CamoufoxIdentityFetchStrategy/fetchPost', () => {
  it('OZ-CIT-01 — first call launches Camoufox and navigates to origin', async () => {
    STATE.envelope = ENV_OK;
    const r = await new STRATEGY(ORIGIN).fetchPost(URL_OK, { id: 'x' }, OPTS);
    const wasOk = isOk(r);
    expect(wasOk).toBe(true);
    expect(STATE.launchCalls).toBe(1);
    expect(STATE.pageGotos).toEqual([ORIGIN]);
  });

  it('OZ-CIT-02 — second call reuses the existing page (no re-launch)', async () => {
    STATE.envelope = ENV_OK;
    const s = new STRATEGY(ORIGIN);
    await s.fetchPost(URL_OK, {}, OPTS);
    await s.fetchPost(URL_OK, {}, OPTS);
    expect(STATE.launchCalls).toBe(1);
    expect(STATE.pageGotos.length).toBe(1);
  });

  it('OZ-CIT-03 — 2xx JSON body parses to succeed(parsedJson)', async () => {
    STATE.envelope = ENV_OK;
    const r = await new STRATEGY(ORIGIN).fetchPost<{ deviceToken: string }>(URL_OK, {}, OPTS);
    const wasOk = isOk(r);
    expect(wasOk).toBe(true);
    if (isOk(r)) expect(r.value.deviceToken).toBe('jwt');
  });

  /** Row for the it.each error-classification table. */
  interface IClassifyCase {
    readonly id: string;
    readonly envelope: IPageFetchEnvelope;
    readonly expectedType: typeof ScraperErrorTypes.WafBlocked | typeof ScraperErrorTypes.Generic;
    readonly expectedSnippet: string;
  }

  const classifyCases: readonly IClassifyCase[] = [
    {
      id: 'OZ-CIT-04',
      envelope: ENV_APP_400,
      expectedType: ScraperErrorTypes.Generic,
      expectedSnippet: 'bad request',
    },
    {
      id: 'OZ-CIT-05a',
      envelope: ENV_CF_OLDIE,
      expectedType: ScraperErrorTypes.WafBlocked,
      expectedSnippet: 'oldie',
    },
    {
      id: 'OZ-CIT-05b',
      envelope: ENV_CF_ERROR,
      expectedType: ScraperErrorTypes.WafBlocked,
      expectedSnippet: 'cf-error',
    },
  ] as const;

  it.each(classifyCases)('$id — non-2xx classified', async (row: IClassifyCase) => {
    STATE.envelope = row.envelope;
    const r = await new STRATEGY(ORIGIN).fetchPost(URL_OK, {}, OPTS);
    const wasOk = isOk(r);
    expect(wasOk).toBe(false);
    if (!isOk(r)) {
      expect(r.errorType).toBe(row.expectedType);
      expect(r.errorMessage).toContain(row.expectedSnippet);
      expect(r.errorMessage).toMatch(/POST https:\/\/[^ ]+ \d+:/);
    }
  });

  it('OZ-CIT-06 — page.evaluate throwing surfaces as network-error failure', async () => {
    STATE.evaluateThrows = true;
    const r = await new STRATEGY(ORIGIN).fetchPost(URL_OK, {}, OPTS);
    const wasOk = isOk(r);
    expect(wasOk).toBe(false);
    if (!isOk(r)) expect(r.errorMessage).toContain('network error');
  });

  it('OZ-CIT-07 — malformed JSON 2xx returns parse-error failure', async () => {
    STATE.envelope = { ok: true, status: 200, bodyText: 'not-json{', setCookies: [] };
    const r = await new STRATEGY(ORIGIN).fetchPost(URL_OK, {}, OPTS);
    const wasOk = isOk(r);
    expect(wasOk).toBe(false);
    if (!isOk(r)) expect(r.errorMessage).toContain('parse error');
  });

  it('OZ-CIT-08 — launch failure surfaces as Generic launch failure', async () => {
    STATE.launchThrows = true;
    const r = await new STRATEGY(ORIGIN).fetchPost(URL_OK, {}, OPTS);
    const wasOk = isOk(r);
    expect(wasOk).toBe(false);
    if (!isOk(r)) expect(r.errorMessage).toContain('camoufox launch failed');
  });

  it('OZ-CIT-11 — disposed strategy returns deterministic Generic failure', async () => {
    const s = new STRATEGY(ORIGIN);
    await s.dispose();
    const r = await s.fetchPost(URL_OK, {}, OPTS);
    const wasOk = isOk(r);
    expect(wasOk).toBe(false);
    if (!isOk(r)) expect(r.errorMessage).toBe('strategy disposed');
    expect(STATE.launchCalls).toBe(0);
  });

  it('OZ-CIT-12 — nav failure after launch returns Generic nav failure', async () => {
    STATE.navThrows = true;
    const r = await new STRATEGY(ORIGIN).fetchPost(URL_OK, {}, OPTS);
    const wasOk = isOk(r);
    expect(wasOk).toBe(false);
    if (!isOk(r)) expect(r.errorMessage).toContain('camoufox nav failed');
  });

  it('OZ-CIT-15 — onSetCookie hook fires once per call with arrays and [] fallback', async () => {
    STATE.envelope = ENV_OK;
    const captured: (readonly string[])[] = [];
    /**
     * Capture hook — records each set-cookie array forwarded by the strategy.
     * @param lines - Set-Cookie lines from the in-page fetch envelope.
     * @returns The new captured length.
     */
    const hook = (lines: readonly string[]): number => captured.push(lines);
    const s = new STRATEGY(ORIGIN);
    await s.fetchPost(URL_OK, {}, { extraHeaders: {}, onSetCookie: hook });
    STATE.envelope = { ok: true, status: 200, bodyText: '{}', setCookies: [] };
    await s.fetchPost(URL_OK, {}, { extraHeaders: {}, onSetCookie: hook });
    expect(captured).toEqual([['sid=abc'], []]);
  });
});

describe('CamoufoxIdentityFetchStrategy/fetchGet', () => {
  it('OZ-CIT-13 — GET 2xx succeeds via page.evaluate', async () => {
    STATE.envelope = ENV_OK;
    const r = await new STRATEGY(ORIGIN).fetchGet(URL_OK, OPTS);
    const wasOk = isOk(r);
    expect(wasOk).toBe(true);
  });

  it('OZ-CIT-14 — GET non-2xx with app body returns Generic failure', async () => {
    STATE.envelope = ENV_APP_400;
    const r = await new STRATEGY(ORIGIN).fetchGet(URL_OK, OPTS);
    const wasOk = isOk(r);
    expect(wasOk).toBe(false);
    if (!isOk(r)) {
      expect(r.errorType).toBe(ScraperErrorTypes.Generic);
      expect(r.errorMessage).toMatch(/GET https:\/\/[^ ]+ 400:/);
    }
  });
});

describe('CamoufoxIdentityFetchStrategy/dispose', () => {
  it('OZ-CIT-09 — dispose closes the browser', async () => {
    STATE.envelope = ENV_OK;
    const s = new STRATEGY(ORIGIN);
    await s.fetchPost(URL_OK, {}, OPTS);
    await s.dispose();
    expect(STATE.closeCalls).toBe(1);
  });

  it('OZ-CIT-10 — dispose is idempotent (second call is no-op)', async () => {
    STATE.envelope = ENV_OK;
    const s = new STRATEGY(ORIGIN);
    await s.fetchPost(URL_OK, {}, OPTS);
    await s.dispose();
    await s.dispose();
    expect(STATE.closeCalls).toBe(1);
  });

  it('OZ-CIT-09b — dispose on never-launched strategy is a no-op', async () => {
    await new STRATEGY(ORIGIN).dispose();
    expect(STATE.closeCalls).toBe(0);
    expect(STATE.launchCalls).toBe(0);
  });

  it('OZ-CIT-09c — dispose swallows browser.close() rejection', async () => {
    STATE.envelope = ENV_OK;
    STATE.closeThrows = true;
    const s = new STRATEGY(ORIGIN);
    await s.fetchPost(URL_OK, {}, OPTS);
    const disposePromise = s.dispose();
    await expect(disposePromise).resolves.toBeUndefined();
    expect(STATE.closeCalls).toBe(1);
  });
});

/** Shape of the synthetic in-browser Response used by OZ-CIT-17. */
interface IStubResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
  readonly headers: { readonly getSetCookie: () => readonly string[] };
}

/**
 * Resolves a stub Response payload — kept module-scope so the nested-call
 * lint rule does not fire when used inside stubFetch.
 * @returns Resolved IStubResponse with success envelope shape.
 */
function resolveStubResponse(): Promise<IStubResponse> {
  const captureCookies: readonly string[] = ['cf_clearance=abc'];
  /**
   * Resolves the synthetic response body text.
   * @returns Resolved JSON string.
   */
  const text = (): Promise<string> => Promise.resolve('{"ok":true}');
  /**
   * Returns the captured Set-Cookie list.
   * @returns The synthetic cookie array.
   */
  const getSetCookie = (): readonly string[] => captureCookies;
  return Promise.resolve({ ok: true, status: 200, text, headers: { getSetCookie } });
}

describe('CamoufoxIdentityFetchStrategy/coverage edges', () => {
  it('OZ-CIT-16 — unparseable origin URL falls through safeUrlForLog catch', async () => {
    STATE.envelope = ENV_OK;
    const r = await new STRATEGY('not a url').fetchPost(URL_OK, {}, OPTS);
    const wasOk = isOk(r);
    expect(wasOk).toBe(true);
  });

  it('OZ-CIT-17 — page.evaluate executes the in-page fetch wrapper for POST and GET', async () => {
    STATE.evaluateRunsCallback = true;
    const stubFetch = jest.fn(resolveStubResponse) as unknown as typeof fetch;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch;
    try {
      const s = new STRATEGY(ORIGIN);
      const postProc = await s.fetchPost(URL_OK, {}, OPTS);
      const getProc = await s.fetchGet(URL_OK, OPTS);
      const wasPostOk = isOk(postProc);
      const wasGetOk = isOk(getProc);
      expect(wasPostOk).toBe(true);
      expect(wasGetOk).toBe(true);
      expect(stubFetch).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
