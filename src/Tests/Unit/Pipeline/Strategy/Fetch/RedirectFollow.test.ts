/**
 * Unit tests for Strategy/Fetch/RedirectFollow — one request under a redirect
 * policy. `follow` leaves fetch alone; `reject` refuses any 3xx; a manual
 * policy follows allowed hops as GETs (a POST only 302/303 under postAsGet),
 * files each hop's Set-Cookie under the hop URL before building the next hop,
 * and recomputes the Cookie header per hop.
 * The transport seam is a fake that serves canned Responses.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  FetchInvoke,
  ISessionHeaders,
} from '../../../../../Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.js';
import type { IRedirectRun } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/RedirectFollow.js';
import { sendUnderPolicy } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/RedirectFollow.js';
import { safeUrlForLog } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/SafeUrlForLog.js';
import type { IManualRedirect } from '../../../../../Scrapers/Pipeline/Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, isOk, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

type Invoke = jest.Mock<ReturnType<FetchInvoke>, Parameters<FetchInvoke>>;

const START = 'https://www.bank.example/start?sid=1';
const HOP_1 = 'https://mto.bank.example/Online/Default.aspx';
const HOP_2 = 'https://mto.bank.example/Online/Default.aspx?language=he-IL';
const SECRET = 'L0CATION-SECRET';
const SAFE_START = safeUrlForLog(START);
const REFUSED = `GET ${SAFE_START} redirect refused`;
const UNDECODABLE = 'cookie XSRF-TOKEN undecodable';

const MANUAL: IManualRedirect = {
  maxHops: 2,
  allow: [
    { origin: 'https://mto.bank.example', paths: ['/Online/Default.aspx'], exactQuery: true },
    {
      origin: 'https://mto.bank.example',
      paths: ['/Online/Default.aspx'],
      query: { language: 'he-IL' },
      exactQuery: true,
    },
  ],
};

/**
 * A redirect response.
 * @param status - 3xx status.
 * @param location - Location header, or none.
 * @param cookies - Set-Cookie lines.
 * @returns The Response.
 */
function redirect(status: number, location?: string, cookies: readonly string[] = []): Response {
  const headers = new Headers();
  if (location !== undefined) headers.set('location', location);
  for (const line of cookies) headers.append('set-cookie', line);
  return new Response(null, { status, headers });
}

/**
 * A plain 200 response.
 * @returns The Response.
 */
function ok(): Response {
  return new Response('{"ok":true}', { status: 200 });
}

/**
 * A fake transport seam serving canned responses in call order.
 * @param served - Responses (or failures) per call.
 * @returns The jest mock.
 */
function serve(served: readonly (Response | Procedure<Response>)[]): Invoke {
  const queue = [...served];
  return jest.fn<ReturnType<FetchInvoke>, Parameters<FetchInvoke>>(() => {
    const next = queue.shift() ?? ok();
    const result = next instanceof Response ? succeed(next) : next;
    return Promise.resolve(result);
  });
}

/**
 * A redirect run with test defaults.
 * @param invoke - Fake transport seam.
 * @param over - Fields to override.
 * @returns The run.
 */
function makeRun(invoke: Invoke, over: Partial<IRedirectRun> = {}): IRedirectRun {
  const headers = { cookie: 'first=1', 'x-caller': 'kept' };
  return {
    url: START,
    init: { method: 'GET', headers },
    verb: 'GET',
    invoke,
    policy: MANUAL,
    ...over,
  };
}

/**
 * The headers one call sent.
 * @param invoke - Fake transport seam.
 * @param call - Call index.
 * @returns The sent headers.
 */
function sentHeaders(invoke: Invoke, call: number): Headers {
  const init = invoke.mock.calls[call][1];
  return new Headers(init.headers);
}

/**
 * The failure text of a refused run.
 * @param result - Run result.
 * @returns The error message.
 */
function failureText(result: Procedure<unknown>): string {
  if (isOk(result)) return 'unexpected success';
  return result.errorMessage;
}

describe('sendUnderPolicy — follow', () => {
  it('sends the request once with the caller init untouched', async () => {
    const invoke = serve([ok()]);
    const run = makeRun(invoke, { policy: 'follow' });
    const result = await sendUnderPolicy(run);
    const isSent = isOk(result);
    expect(isSent).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1]).toBe(run.init);
  });
});

describe('sendUnderPolicy — reject', () => {
  it.each([301, 302, 303, 307, 308])('refuses a %i', async status => {
    const invoke = serve([redirect(status, HOP_1)]);
    const run = makeRun(invoke, { policy: 'reject' });
    const result = await sendUnderPolicy(run);
    const safeUrl = safeUrlForLog(START);
    const text = failureText(result);
    const statusText = String(status);
    expect(text).toBe(`GET ${safeUrl} HTTP ${statusText} redirect refused`);
    expect(invoke.mock.calls[0][1].redirect).toBe('manual');
  });

  it('returns a 2xx response as-is', async () => {
    const invoke = serve([ok()]);
    const run = makeRun(invoke, { policy: 'reject' });
    const result = await sendUnderPolicy(run);
    const isSent = isOk(result);
    expect(isSent).toBe(true);
  });

  it('fails as Generic', async () => {
    const invoke = serve([redirect(302, HOP_1)]);
    const run = makeRun(invoke, { policy: 'reject' });
    const result = await sendUnderPolicy(run);
    const errorType = isOk(result) ? 'none' : result.errorType;
    expect(errorType).toBe(ScraperErrorTypes.Generic);
  });
});

describe('sendUnderPolicy — manual hops', () => {
  it.each([
    { label: 'reject', policy: 'reject', location: HOP_1, success: false },
    {
      label: 'manual refused',
      policy: MANUAL,
      location: 'https://unlisted.example/',
      success: false,
    },
    { label: 'manual allowed', policy: MANUAL, location: HOP_1, success: true },
  ] as const)(
    'cancels a discarded redirect body for $label',
    async ({ policy, location, success }) => {
      const cancel = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
      const body = new ReadableStream<Uint8Array>({ cancel });
      const response = new Response(body, { status: 302, headers: { location } });
      const final = ok();
      const invoke = serve([response, final]);
      const run = makeRun(invoke, { policy });
      const result = await sendUnderPolicy(run);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(final.bodyUsed).toBe(false);
      expect(result.success).toBe(success);
    },
  );

  it('follows two allowed hops and reports the last hop URL', async () => {
    const invoke = serve([redirect(302, HOP_1), redirect(302, HOP_2), ok()]);
    const run = makeRun(invoke);
    const result = await sendUnderPolicy(run);
    const hopUrls = invoke.mock.calls.map(([url]): string => url);
    expect(hopUrls).toEqual([START, HOP_1, HOP_2]);
    const responseUrl = isOk(result) ? result.value.responseUrl : 'failed';
    expect(responseUrl).toBe(HOP_2);
  });

  it("keeps a GET request's content-type on its hops", async () => {
    const invoke = serve([redirect(307, HOP_1), ok()]);
    const init = { method: 'GET', headers: { 'Content-Type': 'text/plain' } };
    const run = makeRun(invoke, { init });
    await sendUnderPolicy(run);
    const [, hopInit, { verb: hopVerb }] = invoke.mock.calls[1];
    expect(hopVerb).toBe('GET');
    expect(hopInit).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(hopInit.body).toBeUndefined();
    expect(invoke.mock.calls[0][1].redirect).toBe('manual');
    const hopType = sentHeaders(invoke, 1).get('content-type');
    expect(hopType).toBe('text/plain');
  });

  it('carries the expected media type through every redirect hop', async () => {
    const invoke = serve([redirect(302, HOP_1), ok()]);
    const run = makeRun(invoke, { mediaType: 'text/html' });
    await sendUnderPolicy(run);
    const policies = invoke.mock.calls.map(([, , policy]): Parameters<FetchInvoke>[2] => policy);
    expect(policies).toEqual([
      { verb: 'GET', mediaType: 'text/html' },
      { verb: 'GET', mediaType: 'text/html' },
    ]);
  });

  it('resolves a relative Location against the hop URL', async () => {
    const invoke = serve([redirect(302, '/Online/Default.aspx?language=he-IL'), ok()]);
    const run = makeRun(invoke, { url: HOP_1 });
    await sendUnderPolicy(run);
    expect(invoke.mock.calls[1][0]).toBe(HOP_2);
  });

  it("replaces the first request's Cookie header with the hop's own", async () => {
    const invoke = serve([redirect(302, HOP_1), redirect(302, HOP_2), ok()]);
    const sessionHeadersFor = jest.fn((url: string): Procedure<ISessionHeaders> => {
      if (url === HOP_1) return succeed({ owned: ['cookie'], values: { cookie: 'hop=1' } });
      return succeed({ owned: ['cookie'], values: {} });
    });
    const run = makeRun(invoke, { sessionHeadersFor });
    await sendUnderPolicy(run);
    const firstCookie = sentHeaders(invoke, 1).get('cookie');
    const secondHop = sentHeaders(invoke, 2);
    const secondCookie = secondHop.get('cookie');
    const callerHeader = secondHop.get('x-caller');
    expect(firstCookie).toBe('hop=1');
    expect(secondCookie).toBeNull();
    expect(callerHeader).toBe('kept');
  });

  it('sends no Cookie header on a hop without a cookie source', async () => {
    const invoke = serve([redirect(302, HOP_1), ok()]);
    const run = makeRun(invoke);
    await sendUnderPolicy(run);
    const hopCookie = sentHeaders(invoke, 1).get('cookie');
    expect(hopCookie).toBeNull();
  });

  it('re-resolves every session-owned header for each hop URL', async () => {
    const invoke = serve([redirect(302, HOP_1), redirect(302, HOP_2), ok()]);
    const owned = ['cookie', 'x-xsrf-token'];
    /**
     * The session's headers per hop: a token for HOP_1 only.
     * @param url - Hop URL.
     * @returns The owned names and the values for the URL.
     */
    const sessionHeadersFor = (url: string): Procedure<ISessionHeaders> => {
      if (url === HOP_1) return succeed({ owned, values: { 'x-xsrf-token': 'mto-token' } });
      return succeed({ owned, values: {} });
    };
    const headers = { 'X-XSRF-TOKEN': 'www-token', 'x-caller': 'kept' };
    const run = makeRun(invoke, { sessionHeadersFor, init: { method: 'GET', headers } });
    await sendUnderPolicy(run);
    const firstHop = sentHeaders(invoke, 1);
    const secondHop = sentHeaders(invoke, 2);
    const tokens = [firstHop.get('x-xsrf-token'), secondHop.get('x-xsrf-token')];
    const callerHeader = secondHop.get('x-caller');
    expect(tokens).toEqual(['mto-token', null]);
    expect(callerHeader).toBe('kept');
  });

  it('drops Authorization on a cross-origin hop and never restores it', async () => {
    const invoke = serve([redirect(302, HOP_1), redirect(302, HOP_2), ok()]);
    const headers = { Authorization: 'Bearer T', 'Proxy-Authorization': 'Basic P' };
    const run = makeRun(invoke, { init: { method: 'GET', headers } });
    await sendUnderPolicy(run);
    const hops = [sentHeaders(invoke, 1), sentHeaders(invoke, 2)];
    const credentials = hops.map((hop): (string | null)[] => [
      hop.get('authorization'),
      hop.get('proxy-authorization'),
    ]);
    expect(credentials).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it('never restores a session-owned Authorization after an origin change', async () => {
    const invoke = serve([redirect(302, HOP_1), redirect(302, HOP_2), ok()]);
    const owned = ['cookie', 'authorization', 'proxy-authorization'];
    const values = { Authorization: 'syn-session-auth', 'Proxy-Authorization': 'syn-proxy' };
    /**
     * The session's credentials headers, the same for every hop URL.
     * @returns The owned names and their values.
     */
    const sessionHeadersFor = (): Procedure<ISessionHeaders> => succeed({ owned, values });
    const run = makeRun(invoke, { sessionHeadersFor });
    await sendUnderPolicy(run);
    const hops = [sentHeaders(invoke, 1), sentHeaders(invoke, 2)];
    const credentials = hops.map((hop): (string | null)[] => [
      hop.get('authorization'),
      hop.get('proxy-authorization'),
    ]);
    expect(credentials).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it('keeps Authorization on a same-origin hop', async () => {
    const invoke = serve([redirect(302, HOP_2), ok()]);
    const init = { method: 'GET', headers: { Authorization: 'Bearer T' } };
    const run = makeRun(invoke, { url: HOP_1, init });
    await sendUnderPolicy(run);
    const hopAuth = sentHeaders(invoke, 1).get('authorization');
    expect(hopAuth).toBe('Bearer T');
  });

  it('files each hop Set-Cookie under the hop URL before the next hop is built', async () => {
    const events: string[] = [];
    const invoke = serve([redirect(302, HOP_1, ['a=1']), redirect(302, HOP_2, ['b=2']), ok()]);
    /**
     * Record a Set-Cookie emission.
     * @param lines - Set-Cookie lines.
     * @param url - URL they were filed under.
     * @returns Line count.
     */
    const onSetCookie = (lines: readonly string[], url?: string): number => {
      const joined = lines.join();
      const urlText = String(url);
      events.push(`set ${joined} ${urlText}`);
      return lines.length;
    };
    /**
     * Record a header lookup.
     * @param url - Hop URL.
     * @returns No header.
     */
    const sessionHeadersFor = (url: string): Procedure<ISessionHeaders> => {
      events.push(`header ${url}`);
      return succeed({ owned: ['cookie'], values: {} });
    };
    const run = makeRun(invoke, { onSetCookie, sessionHeadersFor });
    await sendUnderPolicy(run);
    const expected = [`set a=1 ${START}`, `header ${HOP_1}`, `set b=2 ${HOP_1}`, `header ${HOP_2}`];
    expect(events).toEqual(expected);
  });

  it("stops before a hop whose session headers fail, the hop's cookies filed", async () => {
    const filed: string[] = [];
    const invoke = serve([redirect(302, HOP_1, ['a=1']), ok()]);
    /**
     * Record the filed Set-Cookie lines.
     * @param lines - Set-Cookie lines.
     * @returns Line count.
     */
    const onSetCookie = (lines: readonly string[]): number => filed.push(...lines);
    /**
     * A session whose header resolution fails for every URL.
     * @returns The failure.
     */
    const sessionHeadersFor = (): Procedure<ISessionHeaders> =>
      fail(ScraperErrorTypes.Generic, UNDECODABLE);
    const run = makeRun(invoke, { onSetCookie, sessionHeadersFor });
    const result = await sendUnderPolicy(run);
    expect(result).toMatchObject({ success: false, errorMessage: UNDECODABLE });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(filed).toEqual(['a=1']);
  });

  it('refuses the hop past maxHops', async () => {
    const invoke = serve([redirect(302, HOP_1), redirect(302, HOP_2), redirect(302, HOP_1)]);
    const run = makeRun(invoke);
    const result = await sendUnderPolicy(run);
    const text = failureText(result);
    expect(text).toBe(REFUSED);
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['a missing Location', redirect(302)],
    ['a 300', redirect(300, HOP_1)],
    ['a 304', redirect(304, HOP_1)],
    ['a foreign origin', redirect(302, `https://evil.example/Online/Default.aspx?t=${SECRET}`)],
    ['http', redirect(302, 'http://mto.bank.example/Online/Default.aspx')],
    ['userinfo', redirect(302, 'https://u:p@mto.bank.example/Online/Default.aspx')],
    ['a fragment', redirect(302, `${HOP_1}#${SECRET}`)],
    ['an extra query key', redirect(302, `${HOP_2}&t=${SECRET}`)],
    ['a duplicate query key', redirect(302, `${HOP_2}&language=he-IL`)],
    ['a wrong value', redirect(302, `${HOP_1}?language=${SECRET}`)],
  ])('refuses %s without logging the Location', async (_label, response) => {
    const invoke = serve([response]);
    const run = makeRun(invoke);
    const result = await sendUnderPolicy(run);
    const text = failureText(result);
    expect(text).toBe(REFUSED);
    expect(text).not.toContain(SECRET);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('returns a hop transport failure as-is', async () => {
    const down = fail(ScraperErrorTypes.Timeout, 'GET hop network error: timeout');
    const invoke = serve([redirect(302, HOP_1), down]);
    const run = makeRun(invoke);
    const result = await sendUnderPolicy(run);
    const text = failureText(result);
    expect(text).toBe('GET hop network error: timeout');
  });

  it('returns a first answer that is not a redirect with the request URL', async () => {
    const invoke = serve([ok()]);
    const run = makeRun(invoke);
    const result = await sendUnderPolicy(run);
    const responseUrl = isOk(result) ? result.value.responseUrl : 'failed';
    expect(responseUrl).toBe(START);
  });
});

const POST_AS_GET: IManualRedirect = { ...MANUAL, postAsGet: true };
const POST_REFUSED = `POST ${SAFE_START} redirect refused`;

describe('sendUnderPolicy — accept', () => {
  it.each([204, 205])('returns a bodyless %i untouched for the status policy', async status => {
    const response = new Response(null, { status });
    const invoke = serve([response]);
    const run = makeRun(invoke, { policy: 'accept' });
    const result = await sendUnderPolicy(run);
    expect(isOk(result) ? result.value.response : null).toBe(response);
  });

  it('turns an accepted 302 into a 200 that keeps its body and headers', async () => {
    const response = new Response('handshake', {
      status: 302,
      headers: { location: HOP_1, 'x-edge': 'kept' },
    });
    const invoke = serve([response]);
    const run = makeRun(invoke, { policy: 'accept' });
    const result = await sendUnderPolicy(run);
    const isSent = isOk(result);
    const answered = isOk(result) ? result.value.response : new Response(null);
    const responseUrl = isOk(result) ? result.value.responseUrl : '';
    const edge = answered.headers.get('x-edge');
    const text = await answered.text();
    expect([isSent, answered.status, edge, text, responseUrl]).toEqual([
      true,
      200,
      'kept',
      'handshake',
      START,
    ]);
  });

  it('keeps a 302 untouched when the status policy names an action', async () => {
    const response = new Response('handshake', {
      status: 302,
      headers: { location: HOP_1 },
    });
    const reading = { statusPolicy: { 302: 'rate-limit' as const }, responseKind: 'text' as const };
    const invoke = serve([response]);
    const run = makeRun(invoke, { policy: 'accept', reading });
    const result = await sendUnderPolicy(run);
    expect(isOk(result) ? result.value.response : null).toBe(response);
  });

  it('refuses an accepted redirect body that is not strict UTF-8', async () => {
    const body = new Uint8Array([0xff, 0xfe]);
    const response = new Response(body, { status: 302, headers: { location: HOP_1 } });
    const invoke = serve([response]);
    const reading = { statusPolicy: {}, responseKind: 'text' as const, strictUtf8: true };
    const run = makeRun(invoke, { policy: 'accept', reading });
    const result = await sendUnderPolicy(run);
    const text = failureText(result);
    expect(text).toBe(`GET ${SAFE_START} body not utf-8`);
  });

  it('propagates a redirect body read failure instead of answering empty', async () => {
    const body = new ReadableStream<Uint8Array>({
      /**
       * Fail the stream before a reader can consume it.
       * @param controller - Stream controller.
       * @returns True once the failure is installed.
       */
      start(controller): boolean {
        controller.error(new Error('ECONNRESET'));
        return true;
      },
    });
    const response = new Response(body, { status: 302, headers: { location: HOP_1 } });
    const invoke = serve([response]);
    const run = makeRun(invoke, { policy: 'accept' });
    const result = await sendUnderPolicy(run);
    const text = failureText(result);
    expect(text).toBe(`GET ${SAFE_START} body read failed`);
  });
});

/**
 * A JSON POST run under the given manual policy.
 * @param invoke - Fake transport seam.
 * @param policy - Manual policy.
 * @returns The run.
 */
function postRun(invoke: Invoke, policy: IManualRedirect): IRedirectRun {
  const headers = {
    'Content-Type': 'application/json',
    'Content-Encoding': 'gzip',
    'Content-Language': 'he-IL',
    'Content-Length': '7',
    'Content-Location': '/start',
    'x-caller': 'kept',
  };
  const init = { method: 'POST', headers, body: '{"a":1}' };
  return makeRun(invoke, { verb: 'POST', init, policy });
}

/** Content-describing headers a POST-originated GET must never carry after a hop. */
const BODY_HEADERS = [
  'content-type',
  'content-encoding',
  'content-language',
  'content-length',
  'content-location',
];

describe('sendUnderPolicy — manual POST', () => {
  it.each([302, 303])('follows a %i as a body-less GET without content-type', async status => {
    const invoke = serve([redirect(status, HOP_1), ok()]);
    const run = postRun(invoke, POST_AS_GET);
    const result = await sendUnderPolicy(run);
    const isSent = isOk(result);
    const [[, firstInit], [hopUrl, hopInit, { verb: hopVerb }]] = invoke.mock.calls;
    const hop = sentHeaders(invoke, 1);
    const bodyFields = BODY_HEADERS.map(name => hop.get(name));
    expect(isSent).toBe(true);
    expect(firstInit).toMatchObject({ method: 'POST', body: '{"a":1}', redirect: 'manual' });
    expect([hopUrl, hopVerb, ...bodyFields, hop.get('x-caller')]).toEqual([
      HOP_1,
      'GET',
      null,
      null,
      null,
      null,
      null,
      'kept',
    ]);
    expect(hopInit).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(hopInit.body).toBeUndefined();
  });

  it.each([301, 307, 308])('refuses a %i', async status => {
    const invoke = serve([redirect(status, HOP_1)]);
    const run = postRun(invoke, POST_AS_GET);
    const result = await sendUnderPolicy(run);
    const text = failureText(result);
    expect(text).toBe(POST_REFUSED);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('refuses a 302 when the policy does not name postAsGet', async () => {
    const invoke = serve([redirect(302, HOP_1)]);
    const run = postRun(invoke, MANUAL);
    const result = await sendUnderPolicy(run);
    const text = failureText(result);
    expect(text).toBe(POST_REFUSED);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('follows the GET statuses once a hop is a GET, still dropping body headers', async () => {
    const invoke = serve([redirect(303, HOP_1), redirect(307, HOP_2), ok()]);
    const run = postRun(invoke, POST_AS_GET);
    const result = await sendUnderPolicy(run);
    const responseUrl = isOk(result) ? result.value.responseUrl : 'failed';
    const later = sentHeaders(invoke, 2);
    const laterBodyFields = BODY_HEADERS.map(name => later.get(name));
    expect(responseUrl).toBe(HOP_2);
    expect(laterBodyFields).toEqual([null, null, null, null, null]);
  });
});
