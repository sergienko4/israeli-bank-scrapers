/**
 * N40 — a GET step sent to a carried URL. `urlFromCarry` names the carry
 * slot holding an absolute URL an earlier step checked; the step sends there
 * instead of its WK url, and everything that reads the step URL reads the
 * carried one: a raw query, the extract URL rules, the form action and the
 * client cookies. A slot that is absent, not text or not an absolute URL fails
 * before anything is sent. The cases drive the real mediator over the
 * headless native transport.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { createHeadlessApiMediator } from '../../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { ITokenBus } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenBus.js';
import { fakeFetch, type IFetchFake } from '../../../../../Helpers/FakeFetch.js';
import { makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';

const HINT = CompanyTypes.OneZero;
const WK_ORIGIN = 'https://example.test';
const BANK = 'https://bank.test';
const SERVLET = `${BANK}/MatafLoginService/MatafLoginServlet`;
const HANDOFF = `${SERVLET}?t=syn-ticket`;
const CARRIED_RULES = [{ origin: BANK, anyPathExcept: ['logout', 'changepass'] }] as const;
const CARRIED_INVALID = 'landing carried url invalid';
const LOGIN_PAGE =
  '<form name="loginServlet" method="post" action="MatafLoginServlet">' +
  '<input type="hidden" name="user" value=""><input type="hidden" name="bankId" value="031">' +
  '</form>';

const PLAIN_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

const LANDING_STEP: IGetStep = {
  name: 'landing',
  urlTag: 'auth.bind',
  method: 'GET',
  urlFromCarry: 'handoffUrl',
  extractsToCarry: { token: '/access_token' },
};

const RAW_STEP: IGetStep = { ...LANDING_STEP, rawQuery: { parts: [{ literal: 'x=1' }] } };

const RULED_STEP: IGetStep = {
  ...LANDING_STEP,
  extractsToCarry: { next: '/next' },
  extractRules: { next: { url: [{ origin: BANK, paths: ['/portal/next'] }] } },
};

const FORM_STEP: IGetStep = {
  ...LANDING_STEP,
  response: 'text',
  extractsToCarry: {},
  formCapture: {
    form: 'loginServlet',
    into: 'loginForm',
    action: SERVLET,
    required: ['user', 'bankId'],
    forbidden: ['password'],
    minFields: 2,
    maxFields: 32,
  },
};

const COOKIE_STEP: IGetStep = { ...LANDING_STEP, setCookies: { G3CmE: 'carry.g3' } };

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, `${WK_ORIGIN}/api/bind`);
});

/**
 * A template scope with the given carry.
 * @param carry - Carry slots.
 * @returns Template scope.
 */
function scopeWith(carry: Readonly<Record<string, JsonValue>>): ITemplateScope {
  return { carry, creds: {}, config: PLAIN_CONFIG, keypair: undefined };
}

/**
 * Point globalThis.fetch at a fake that answers every request with `answer`.
 * @param answer - Builds each answer.
 * @returns The fake, for request assertions.
 */
function install(answer: () => Response): IFetchFake {
  const fake = fakeFetch(answer);
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

/**
 * A JSON answer with a token and the next URL.
 * @returns The answer.
 */
function tokenAnswer(): Response {
  return Response.json({ access_token: 'syn-token', next: '/portal/next' });
}

/**
 * A headless mediator whose cookie session covers the bank's domain.
 * @returns The bus.
 */
function jarBus(): ITokenBus {
  return createHeadlessApiMediator({
    bankHint: HINT,
    identityBaseUrl: `${WK_ORIGIN}/`,
    graphqlUrl: `${WK_ORIGIN}/graphql`,
    sessionCookies: true,
    cookieDomains: ['bank.test'],
  });
}

/**
 * Run one step over the plain native mediator.
 * @param step - Step under test.
 * @param carry - Carry before the step.
 * @returns The step result.
 */
async function runOver(
  step: IGetStep,
  carry: Readonly<Record<string, JsonValue>>,
): ReturnType<typeof runStep> {
  const bus = makeNativeMediator(HINT, WK_ORIGIN);
  const scope = scopeWith(carry);
  return runStep({ step, bus, scope, companyId: HINT, carriedUrlRules: CARRIED_RULES });
}

/**
 * The Cookie header of one recorded request.
 * @param fake - Fetch fake.
 * @returns The header, '' when absent.
 */
function cookieSent(fake: IFetchFake): string {
  const headers = fake.calls[0].init.headers as Partial<Record<string, string>>;
  return headers.cookie ?? '';
}

describe('N40 urlFromCarry', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('sends to the carried URL instead of the WK url', async (): Promise<void> => {
    const fake = install(tokenAnswer);
    const result = await runOver(LANDING_STEP, { handoffUrl: HANDOFF });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe(HANDOFF);
    expect(result).toMatchObject({ success: true, value: { carry: { token: 'syn-token' } } });
  });

  it('appends a raw query to the carried URL', async (): Promise<void> => {
    const fake = install(tokenAnswer);
    await runOver(RAW_STEP, { handoffUrl: HANDOFF });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe(`${HANDOFF}&x=1`);
  });

  it('resolves a relative extract URL against the carried URL', async (): Promise<void> => {
    install(tokenAnswer);
    const result = await runOver(RULED_STEP, { handoffUrl: HANDOFF });
    expect(result).toMatchObject({ success: true, value: { carry: { next: '/portal/next' } } });
  });

  it('resolves a relative form action against the carried URL', async (): Promise<void> => {
    install((): Response => new Response(LOGIN_PAGE, { status: 200 }));
    const result = await runOver(FORM_STEP, { handoffUrl: HANDOFF });
    const loginForm = { user: '', bankId: '031' };
    expect(result).toMatchObject({ success: true, value: { carry: { loginForm } } });
  });

  it('files client cookies for the carried URL', async (): Promise<void> => {
    const fake = install(tokenAnswer);
    const bus = jarBus();
    const scope = scopeWith({ handoffUrl: HANDOFF, g3: 'syn-g3' });
    const result = await runStep({
      step: COOKIE_STEP,
      bus,
      scope,
      companyId: HINT,
      carriedUrlRules: CARRIED_RULES,
    });
    const sent = cookieSent(fake);
    expect(result).toMatchObject({ success: true });
    expect(fake.calls[0].url).toBe(HANDOFF);
    expect(sent).toContain('G3CmE=syn-g3');
  });

  it.each<[string, Readonly<Record<string, JsonValue>>]>([
    ['the slot is absent', {}],
    ['the slot is not text', { handoffUrl: 7 }],
    ['the slot is a relative URL', { handoffUrl: '/portal/landing' }],
    ['the slot is not a URL', { handoffUrl: 'not a url' }],
  ])('fails before sending when %s', async (_label, carry): Promise<void> => {
    const fake = install(tokenAnswer);
    const result = await runOver(LANDING_STEP, carry);
    expect(fake.calls).toHaveLength(0);
    expect(result).toMatchObject({ success: false, errorMessage: CARRIED_INVALID });
  });

  it.each([
    ['another origin', 'https://outside.test/collect'],
    ['an encoded denied path', `${BANK}/wps/lo%67out`],
  ])('refuses %s before sending', async (_label, handoffUrl): Promise<void> => {
    const fake = install(tokenAnswer);
    const result = await runOver(LANDING_STEP, { handoffUrl });
    expect(fake.calls).toHaveLength(0);
    expect(result).toMatchObject({ success: false, errorMessage: CARRIED_INVALID });
  });
});
