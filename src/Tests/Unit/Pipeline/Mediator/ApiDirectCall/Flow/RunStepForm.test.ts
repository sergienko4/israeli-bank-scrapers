/**
 * A POST step naming `encoding: 'form'` sends its hydrated flat record
 * form-encoded through the real mediator and headless native transport; a
 * value that hydrates to anything but a string, finite number or boolean
 * fails the step before any request.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import type {
  IApiDirectCallConfig,
  IPostStep,
  JsonValueTemplate,
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

const FORM_SHAPE: JsonValueTemplate = {
  identifier: { $ref: 'creds.userCode' },
  mfp: { $literal: '' },
  retries: { $literal: 2 },
  remember: { $literal: false },
};

const FORM_STEP: IPostStep = {
  name: 'login',
  urlTag: 'auth.login',
  encoding: 'form',
  body: { shape: FORM_SHAPE },
  extractsToCarry: {},
};

beforeAll((): void => {
  registerWkUrl('auth.login', HINT, `${ORIGIN}/api/login`);
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
 * Point fetch at a fake that answers every call with `{}`.
 * @returns The fake, for request assertions.
 */
function serveEmpty(): IFetchFake {
  const fake = fakeFetch((): Response => Response.json({}));
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

describe('form-encoded login steps', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('sends the hydrated record form-encoded, in config order', async () => {
    const fake = serveEmpty();
    const bus = makeNativeMediator(HINT, ORIGIN);
    const scope = scopeWith('syn-user');
    const result = await runStep({ step: FORM_STEP, bus, scope, companyId: HINT });
    expect(result.success).toBe(true);
    expect(fake.calls[0].init.body).toBe('identifier=syn-user&mfp=&retries=2&remember=false');
    const headers = fake.calls[0].init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/x-www-form-urlencoded');
  });

  it.each([
    ['an array', ['a']],
    ['an object', { a: 'b' }],
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('fails before any request when a value hydrates to %s', async (_label, value) => {
    const fake = serveEmpty();
    const bus = makeNativeMediator(HINT, ORIGIN);
    const scope = scopeWith(value);
    const result = await runStep({ step: FORM_STEP, bus, scope, companyId: HINT });
    expect(result).toMatchObject({ success: false, errorMessage: 'login form body not flat' });
    expect(fake.calls).toHaveLength(0);
  });
});
