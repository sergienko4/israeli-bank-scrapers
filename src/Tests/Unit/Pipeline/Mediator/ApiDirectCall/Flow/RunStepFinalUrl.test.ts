/**
 * A GET step with a manual redirect may name a `finalUrlInto` slot:
 * after its last hop, the URL that gave the final answer is carried there,
 * once it passes the step's own `redirect.allow` rules; otherwise the step
 * fails `<step> final url refused`, naming no URL. A later step reads the slot
 * like any carry slot, e.g. as a `Referer` header template. The cases drive
 * the real mediator over the headless native transport.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fakeFetch, type IFetchFake } from '../../../../../Helpers/FakeFetch.js';
import { makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';
import { makeStubMediator } from './StubMediator.js';

const HINT = CompanyTypes.OneZero;
const WK_ORIGIN = 'https://example.test';
const BANK = 'https://bank.test';
const START = `${BANK}/portal/start?t=syn-ticket`;
const LANDING = `${BANK}/portal/landing`;
const CAPTURE_START = `${BANK}/auth/start`;
const CARRIED_RULES = [{ origin: BANK, paths: ['/portal/start', '/portal/landing'] }] as const;

const CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

/** The handoff GET: up to three hops inside the portal, its final URL carried. */
const HANDOFF_STEP: IGetStep = {
  name: 'landing',
  urlTag: 'auth.bind',
  method: 'GET',
  urlFromCarry: 'handoffUrl',
  extractsToCarry: {},
  redirect: { maxHops: 3, allow: CARRIED_RULES },
  finalUrlInto: 'landingUrl',
};

/** The same step, whose rules allow only the landing page. */
const LANDING_ONLY: IGetStep = {
  ...HANDOFF_STEP,
  redirect: { maxHops: 3, allow: [{ origin: BANK, paths: ['/portal/landing'] }] },
};

/** A later GET naming the carried final URL as its Referer. */
const MENU_STEP: IGetStep = {
  name: 'prime',
  urlTag: 'auth.bind',
  method: 'GET',
  headers: { Referer: { $ref: 'carry.landingUrl' } },
  extractsToCarry: {},
};

const CAPTURE_STEP: IGetStep = {
  name: 'landing',
  urlTag: 'auth.bootstrap',
  method: 'GET',
  response: 'text',
  extractsToCarry: {},
  redirect: { maxHops: 1, allow: [{ origin: BANK, paths: ['/portal/landing'] }] },
};

const LOCATION_STEP: IGetStep = {
  ...CAPTURE_STEP,
  locationCapture: {
    into: 'nextUrl',
    userAgent: 'Mozilla/5.0',
    url: [{ origin: BANK, paths: ['/portal/next'] }],
  },
};

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, `${WK_ORIGIN}/api/bind`);
  registerWkUrl('auth.bootstrap', HINT, CAPTURE_START);
});

/**
 * Point fetch at a fake: the start URL redirects to the landing page when
 * `hasHop`, and every other request answers JSON.
 * @param hasHop - Whether the start URL redirects.
 * @returns The fake, for request assertions.
 */
function serve(hasHop: boolean): IFetchFake {
  const fake = fakeFetch((url: string): Response => {
    if (hasHop && url === START)
      return new Response(null, { status: 302, headers: { location: '/portal/landing' } });
    return Response.json({});
  });
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

/**
 * Answer a redirect with text from another directory on the same origin.
 * @param html - Landing page text.
 * @returns The fake, for request assertions.
 */
function serveLanding(html: string): IFetchFake {
  const fake = fakeFetch((url: string): Response => {
    if (url === CAPTURE_START)
      return new Response(null, { status: 302, headers: { location: LANDING } });
    return new Response(html, { status: 200 });
  });
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

/**
 * Run one step over the native mediator.
 * @param step - Step under test.
 * @param carry - Carry before the step.
 * @returns The step result.
 */
async function runOver(
  step: IGetStep,
  carry: Readonly<Record<string, JsonValue>>,
): ReturnType<typeof runStep> {
  const bus = makeNativeMediator(HINT, WK_ORIGIN);
  const scope: ITemplateScope = { carry, creds: {}, config: CONFIG, keypair: undefined };
  return runStep({ step, bus, scope, companyId: HINT, carriedUrlRules: CARRIED_RULES });
}

/**
 * The value of one header a recorded request sent, whatever its case.
 * @param fake - Fetch fake.
 * @param index - Request index.
 * @param name - Lower-case header name.
 * @returns The header value, '' when absent.
 */
function headerSent(fake: IFetchFake, index: number, name: string): string {
  const headers = new Headers(fake.calls[index].init.headers);
  return headers.get(name) ?? '';
}

describe('final response URLs', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('carries the URL that gave the final answer after its hops', async () => {
    const fake = serve(true);
    const result = await runOver(HANDOFF_STEP, { handoffUrl: START });
    if (!result.success) throw new TypeError(result.errorMessage);
    const requested = fake.calls.map(call => call.url);
    expect(requested).toEqual([START, LANDING]);
    expect(result.value.carry.landingUrl).toBe(LANDING);
  });

  it('carries the request URL when nothing redirects', async () => {
    serve(false);
    const result = await runOver(HANDOFF_STEP, { handoffUrl: START });
    if (!result.success) throw new TypeError(result.errorMessage);
    expect(result.value.carry.landingUrl).toBe(START);
  });

  it('refuses a final URL off the redirect rules, naming no URL', async () => {
    serve(false);
    const result = await runOver(LANDING_ONLY, { handoffUrl: START });
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'landing final url refused',
    });
    const text = JSON.stringify(result);
    expect(text).not.toContain('syn-ticket');
  });

  it('lets a later step send it as a header', async () => {
    const fake = serve(true);
    const handed = await runOver(HANDOFF_STEP, { handoffUrl: START });
    if (!handed.success) throw new TypeError(handed.errorMessage);
    const menu = await runOver(MENU_STEP, handed.value.carry);
    expect(menu.success).toBe(true);
    const referer = headerSent(fake, 2, 'referer');
    expect(referer).toBe(LANDING);
  });

  it('resolves a relative form action against the answered URL without finalUrlInto', async () => {
    const html =
      '<form name="login" method="post" action="submit"><input type="hidden" name="ticket" value="syn-value"></form>';
    const fake = serveLanding(html);
    const formCapture = {
      form: 'login',
      into: 'loginForm',
      action: `${BANK}/portal/submit`,
      required: ['ticket'],
      forbidden: [],
      minFields: 1,
      maxFields: 1,
    };
    const result = await runOver({ ...CAPTURE_STEP, formCapture }, {});
    const requested = fake.calls.map(call => call.url);
    expect(requested).toEqual([CAPTURE_START, LANDING]);
    expect(result.success && result.value.carry.loginForm).toEqual({ ticket: 'syn-value' });
  });

  it('resolves a relative handoff against the answered URL without finalUrlInto', async () => {
    const html = "<script>window.location.href = 'next';</script>";
    const fake = serveLanding(html);
    const result = await runOver(LOCATION_STEP, {});
    const requested = fake.calls.map(call => call.url);
    expect(requested).toEqual([CAPTURE_START, LANDING]);
    expect(result.success && result.value.carry.nextUrl).toBe(`${BANK}/portal/next`);
  });

  it('refuses relative captures when the transport omits the answering URL', async () => {
    const html = "<script>window.location.href = 'next';</script>";
    const answered = succeed({ text: html });
    const bus = makeStubMediator({ responses: [answered], captures: [] });
    const scope: ITemplateScope = { carry: {}, creds: {}, config: CONFIG, keypair: undefined };
    const result = await runStep({ step: LOCATION_STEP, bus, scope, companyId: HINT });
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'landing answer url missing',
    });
  });
});
