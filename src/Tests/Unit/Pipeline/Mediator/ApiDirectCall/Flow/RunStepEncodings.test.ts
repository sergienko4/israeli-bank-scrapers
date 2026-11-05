/**
 * N23 — login steps naming `encoding: 'form-latin1'` or `encoding: 'text'`,
 * and `response: 'text'`, run through the real mediator and headless native
 * transport. Every refusal fails the step by name with a fixed reason and
 * names no value.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import type {
  IApiDirectCallConfig,
  IPostStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { fakeFetch, type IFetchFake } from '../../../../../Helpers/FakeFetch.js';
import { makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';

const HINT = CompanyTypes.OneZero;
const ORIGIN = 'https://example.test';

const PLAIN_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

const LATIN1_STEP: IPostStep = {
  name: 'login',
  urlTag: 'auth.login',
  encoding: 'form-latin1',
  body: { shape: { username: { $ref: 'creds.userCode' }, n: { $literal: 1 } } },
  extractsToCarry: {},
};

const TEXT_STEP: IPostStep = {
  name: 'register',
  urlTag: 'auth.bind',
  encoding: 'text',
  response: 'text',
  body: { shape: { text: { $ref: 'creds.userCode' } } },
  extractsToCarry: { pem: '/text' },
};

beforeAll((): void => {
  registerWkUrl('auth.login', HINT, `${ORIGIN}/api/login`);
  registerWkUrl('auth.bind', HINT, `${ORIGIN}/api/register`);
});

/**
 * Template scope whose `userCode` credential holds the given value.
 * @param userCode - Credential value.
 * @returns Template scope.
 */
function scopeWith(userCode: unknown): ITemplateScope {
  const creds = { userCode } as unknown as Record<string, string>;
  return { carry: {}, creds, config: PLAIN_CONFIG, keypair: undefined };
}

/**
 * Point fetch at a fake that answers every call with one body.
 * @param body - Response body text.
 * @returns The fake, for request assertions.
 */
function serveText(body: string): IFetchFake {
  const fake = fakeFetch((): Response => new Response(body, { status: 200 }));
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

describe('N23 latin1 forms, text bodies and text answers on login steps', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('sends a latin1 form under the ISO-8859-1 content-type', async () => {
    const fake = serveText('{}');
    const bus = makeNativeMediator(HINT, ORIGIN);
    const result = await runStep({
      step: LATIN1_STEP,
      bus,
      scope: scopeWith('a b*~ç'),
      companyId: HINT,
    });
    expect(result.success).toBe(true);
    expect(fake.calls[0].init.body).toBe('username=a+b*%7E%E7&n=1');
    const headers = fake.calls[0].init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded; charset=ISO-8859-1');
  });

  it('fails a latin1 step on a char above U+00FF before any request', async () => {
    const fake = serveText('{}');
    const bus = makeNativeMediator(HINT, ORIGIN);
    const result = await runStep({
      step: LATIN1_STEP,
      bus,
      scope: scopeWith('€'),
      companyId: HINT,
    });
    expect(result).toMatchObject({ success: false, errorMessage: 'login form-latin1 unencodable' });
    expect(fake.calls).toHaveLength(0);
  });

  it('fails a nested latin1 form before any request', async () => {
    const fake = serveText('{}');
    const bus = makeNativeMediator(HINT, ORIGIN);
    const result = await runStep({
      step: LATIN1_STEP,
      bus,
      scope: scopeWith(['a']),
      companyId: HINT,
    });
    expect(result).toMatchObject({ success: false, errorMessage: 'login form body not flat' });
    expect(fake.calls).toHaveLength(0);
  });

  it('sends a text body verbatim and carries the text answer', async () => {
    const fake = serveText('-----BEGIN CERTIFICATE-----');
    const bus = makeNativeMediator(HINT, ORIGIN);
    const result = await runStep({
      step: TEXT_STEP,
      bus,
      scope: scopeWith('MIIC_x-y'),
      companyId: HINT,
    });
    const bytes = new TextEncoder().encode('MIIC_x-y');
    expect(fake.calls[0].init.body).toEqual(bytes);
    const headers = fake.calls[0].init.headers as Record<string, string>;
    expect(headers['content-type']).toBeUndefined();
    const carry = { pem: '-----BEGIN CERTIFICATE-----' };
    expect(result).toMatchObject({ success: true, value: { carry } });
  });

  it('fails a text step whose body is not a string before any request', async () => {
    const fake = serveText('{}');
    const bus = makeNativeMediator(HINT, ORIGIN);
    const result = await runStep({ step: TEXT_STEP, bus, scope: scopeWith(7), companyId: HINT });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'register text body not a string',
    });
    expect(fake.calls).toHaveLength(0);
  });

  it('fails a text answer over 65 536 chars by step name', async () => {
    const tooLong = 'a'.repeat(65_537);
    serveText(tooLong);
    const bus = makeNativeMediator(HINT, ORIGIN);
    const scope = scopeWith('x');
    const result = await runStep({ step: TEXT_STEP, bus, scope, companyId: HINT });
    expect(result).toMatchObject({ success: false, errorMessage: 'register text too long' });
  });
});
