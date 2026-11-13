/**
 * SDK capture uses the actual answering URL and admits only checked carry URLs.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { validateApiDirectConfig } from '../../../../../../Scrapers/Pipeline/Core/Builder/Validation/ApiDirectConfigRules.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/RunStep.js';
import { carriedUrlRulesOf } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Steps/RunStep.carriedUrlRules.js';
import {
  registerWkUrl,
  resetWkRegistryForTest,
} from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { fakeFetch } from '../../../../../Helpers/FakeFetch.js';
import { makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';

const ORIGIN = 'https://bank.example';
const RULES = [{ origin: ORIGIN, paths: ['/gate/sdk.js'] }] as const;
const STEP: IGetStep = {
  name: 'bootstrap',
  urlTag: 'auth.bind',
  method: 'GET',
  response: 'text',
  extractsToCarry: {},
  structuredCapture: { kind: 'sdk-reference', into: 'sdkUrl', url: RULES },
};
const NEXT: IGetStep = {
  name: 'prime',
  urlTag: 'auth.bind',
  method: 'GET',
  urlFromCarry: 'sdkUrl',
  response: 'text',
  extractsToCarry: {},
};
const CONFIG: IApiDirectCallConfig = { flow: 'sms-otp', envelope: {}, steps: [STEP, NEXT] };

describe('SDK reference routing', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    resetWkRegistryForTest();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('passes a captured, allowlisted SDK URL to a later GET', async () => {
    registerWkUrl('auth.bind', CompanyTypes.OneZero, `${ORIGIN}/gate/index`);
    const fake = fakeFetch(() => new Response('<script src="sdk.js"></script>'));
    globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
    const bus = makeNativeMediator(CompanyTypes.OneZero, ORIGIN);
    const scope = { carry: {}, creds: {}, config: CONFIG, keypair: undefined };
    const result = await runStep({ step: STEP, scope, bus, companyId: CompanyTypes.OneZero });
    expect(result).toMatchObject({
      success: true,
      value: { carry: { sdkUrl: `${ORIGIN}/gate/sdk.js` } },
    });
    if (!result.success) throw new TypeError('SDK capture failed');
    const carriedUrlRules = carriedUrlRulesOf(CONFIG.steps, 1);
    const next = await runStep({
      step: NEXT,
      scope: result.value,
      bus,
      companyId: CompanyTypes.OneZero,
      carriedUrlRules,
    });
    expect(next.success).toBe(true);
    const urls = fake.calls.map(call => call.url);
    expect(urls).toEqual([`${ORIGIN}/gate/index`, `${ORIGIN}/gate/sdk.js`]);
  });

  it('admits checked SDK carry and refuses a duplicate output slot', () => {
    const transportConfig = {
      identityBase: ORIGIN,
      graphql: `${ORIGIN}/graphql`,
      paths: {},
      nativeFetch: true,
    };
    const valid = validateApiDirectConfig({ transport: transportConfig, call: CONFIG });
    const conflicting = { ...STEP, extractsToCarry: { sdkUrl: '/text' } };
    const invalid = validateApiDirectConfig({
      transport: transportConfig,
      call: { ...CONFIG, steps: [conflicting, NEXT] },
    });
    expect(valid).toMatchObject({ success: true });
    expect(invalid).toMatchObject({ success: false });
  });

  it('refuses malformed capture fields without exposing their values', () => {
    const transportConfig = {
      identityBase: ORIGIN,
      graphql: `${ORIGIN}/graphql`,
      paths: {},
      nativeFetch: true,
    };
    const badFields = [
      ['kind', 'unknown'],
      ['into', null],
      ['url', null],
      ['url', []],
      ['url', [null]],
      ['url', [{ origin: 'http://bank.example', paths: ['/sdk.js'] }]],
      ['url', [{ origin: ORIGIN, paths: [null] }]],
      ['url', [{ origin: ORIGIN, paths: ['sdk.js'] }]],
      ['url', [{ origin: ORIGIN, paths: ['/sdk.js'], query: { lang: null } }]],
    ] as const;
    for (const [field, value] of badFields) {
      const capture = { kind: 'sdk-reference', into: 'sdkUrl', url: RULES } as const;
      Reflect.set(capture, field, value);
      const step = { ...STEP, structuredCapture: capture };
      const result = validateApiDirectConfig({
        transport: transportConfig,
        call: { ...CONFIG, steps: [step, NEXT] },
      });
      expect(result).toMatchObject({
        success: false,
        errorMessage: 'steps.structuredCapture: invalid capture',
      });
    }
    const step = { ...STEP };
    Reflect.set(step, 'structuredCapture', null);
    const result = validateApiDirectConfig({
      transport: transportConfig,
      call: { ...CONFIG, steps: [step] },
    });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'steps.structuredCapture: invalid capture',
    });
  });

  it('refuses an SDK capture on a JSON response before issuing a request', () => {
    const transportConfig = {
      identityBase: ORIGIN,
      graphql: `${ORIGIN}/graphql`,
      paths: {},
      nativeFetch: true,
    };
    const step: IGetStep = { ...STEP, response: 'json' };
    const result = validateApiDirectConfig({
      transport: transportConfig,
      call: { ...CONFIG, steps: [step] },
    });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'steps.structuredCapture: needs a text response',
    });
  });

  it('rejects capture collisions with generators and classifier case captures', () => {
    const transportConfig = {
      identityBase: ORIGIN,
      graphql: `${ORIGIN}/graphql`,
      paths: {},
      nativeFetch: true,
    };
    const changes: readonly Partial<IGetStep>[] = [
      { generate: [{ kind: 'rsa-key', bits: 2048, keyInto: 'sdkUrl' }] },
      {
        classify: {
          into: 'kind',
          cases: [
            { name: 'ok', when: [], captures: { sdkUrl: { pointer: '/sdk', maxChars: 20 } } },
          ],
        },
      },
    ];
    for (const change of changes) {
      const step = { ...STEP, ...change };
      const result = validateApiDirectConfig({
        transport: transportConfig,
        call: { ...CONFIG, steps: [step, NEXT] },
      });
      expect(result).toMatchObject({
        success: false,
        errorMessage: 'steps.structuredCapture: must be a fresh slot',
      });
    }
  });

  it('resolves a relative script against the final redirect answer', async () => {
    registerWkUrl('auth.bind', CompanyTypes.OneZero, `${ORIGIN}/start`);
    const fake = fakeFetch(url => {
      if (url.endsWith('/start')) {
        return new Response('', { status: 302, headers: { location: `${ORIGIN}/gate/index` } });
      }
      return new Response('<script src="sdk.js"></script>');
    });
    globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
    const redirect = { maxHops: 1, allow: [{ origin: ORIGIN, paths: ['/gate/index'] }] };
    const step: IGetStep = { ...STEP, redirect };
    const bus = makeNativeMediator(CompanyTypes.OneZero, ORIGIN);
    const scope = { carry: {}, creds: {}, config: CONFIG, keypair: undefined };
    const result = await runStep({ step, scope, bus, companyId: CompanyTypes.OneZero });
    expect(result).toMatchObject({
      success: true,
      value: { carry: { sdkUrl: `${ORIGIN}/gate/sdk.js` } },
    });
  });

  it('refuses an overwritten carried URL before making another request', async () => {
    const fake = fakeFetch(() => new Response('unexpected'));
    globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
    const bus = makeNativeMediator(CompanyTypes.OneZero, ORIGIN);
    const scope = {
      carry: { sdkUrl: 'https://other.example/sdk.js' },
      creds: {},
      config: CONFIG,
      keypair: undefined,
    };
    const result = await runStep({
      step: NEXT,
      scope,
      bus,
      companyId: CompanyTypes.OneZero,
      carriedUrlRules: RULES,
    });
    expect(result).toMatchObject({ success: false });
    expect(fake.calls).toHaveLength(0);
  });
});
