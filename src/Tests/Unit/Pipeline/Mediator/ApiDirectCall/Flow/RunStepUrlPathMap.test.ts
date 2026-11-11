/**
 * A checked URL path map preserves the source query and admits only ruled targets.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { validateApiDirectConfig } from '../../../../../../Scrapers/Pipeline/Core/Builder/Validation/ApiDirectConfigRules.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/RunStep.js';
import { carriedUrlRulesOf } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Steps/RunStep.carriedUrlRules.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { fakeFetch } from '../../../../../Helpers/FakeFetch.js';
import { makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';

const ORIGIN = 'https://bank.example';
const USERINFO = new URL(`${ORIGIN}/gate/?lang=1`);
USERINFO.username = 'synthetic';
const SOURCE_RULES = [
  { origin: ORIGIN, paths: ['/gate/', '/gate/he/'], query: { lang: '1' } },
  { origin: ORIGIN, paths: ['/gate/', '/gate/en/'], query: { lang: '2' } },
] as const;
const TARGET_RULES = [
  { origin: ORIGIN, paths: ['/gate/he/'], query: { lang: '1' } },
  { origin: ORIGIN, paths: ['/gate/en/'], query: { lang: '2' } },
] as const;
const OP = {
  kind: 'url-path-map',
  key: 'lang',
  paths: { '1': '/gate/he/', '2': '/gate/en/' },
  source: SOURCE_RULES,
  url: TARGET_RULES,
} as const;
const DERIVATION = { into: 'target', parts: ['carry.entry'], op: OP } as const;
const FIRST: IGetStep = {
  name: 'bootstrap',
  urlTag: 'auth.bind',
  method: 'GET',
  extractsToCarry: {},
  deriveCarry: [DERIVATION],
};
const NEXT: IGetStep = {
  name: 'landing',
  urlTag: 'auth.login',
  method: 'GET',
  urlFromCarry: 'target',
  extractsToCarry: {},
};
const CONFIG: IApiDirectCallConfig = { flow: 'sms-otp', envelope: {}, steps: [FIRST, NEXT] };
const HEADLESS = {
  identityBase: ORIGIN,
  graphql: `${ORIGIN}/graphql`,
  paths: {},
  nativeFetch: true,
};

/**
 * Runs a mapping against a synthetic source URL using the actual step dispatcher.
 * @param entry - Source URL.
 * @param first - Step defining the mapping.
 * @returns Step result and recorded requests.
 */
async function runMapping(
  entry: string,
  first: IGetStep = FIRST,
): Promise<{
  result: Awaited<ReturnType<typeof runStep>>;
  isNextSuccessful: boolean;
  calls: string[];
}> {
  const fake = fakeFetch(() => Response.json({}));
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  const bus = makeNativeMediator(CompanyTypes.OneZero, ORIGIN);
  const config = { ...CONFIG, steps: [first, NEXT] };
  const scope = { carry: { entry }, creds: {}, config, keypair: undefined };
  const result = await runStep({ step: first, scope, bus, companyId: CompanyTypes.OneZero });
  let isNextSuccessful = false;
  if (result.success) {
    const carriedUrlRules = carriedUrlRulesOf(config.steps, 1);
    const nextResult = await runStep({
      step: NEXT,
      scope: result.value,
      bus,
      companyId: CompanyTypes.OneZero,
      carriedUrlRules,
    });
    isNextSuccessful = nextResult.success;
  }
  return { result, isNextSuccessful, calls: fake.calls.map(call => call.url) };
}

describe('checked URL path mapping', () => {
  const originalFetch = globalThis.fetch;
  beforeAll(() => {
    registerWkUrl('auth.bind', CompanyTypes.OneZero, `${ORIGIN}/start`);
    registerWkUrl('auth.login', CompanyTypes.OneZero, `${ORIGIN}/fallback`);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each([
    ['1', 'he'],
    ['2', 'en'],
  ])('retains the complete query when language %s selects %s', async (language, path) => {
    const query = `tracking=route%2B1&lang=${language}&extra=keep%20this`;
    const { result, isNextSuccessful, calls } = await runMapping(`${ORIGIN}/gate/?${query}`);
    expect(result.success).toBe(true);
    expect(isNextSuccessful).toBe(true);
    expect(calls).toEqual([`${ORIGIN}/start`, `${ORIGIN}/gate/${path}/?${query}`]);
    expect(validateApiDirectConfig({ call: CONFIG, transport: HEADLESS }).success).toBe(true);
  });

  it.each([
    ['foreign origin', 'https://foreign.example/gate/?lang=1'],
    ['unexpected path', `${ORIGIN}/other/?lang=1`],
    ['mismatched language path', `${ORIGIN}/gate/en/?lang=1`],
    ['userinfo', USERINFO.href],
    ['missing language', `${ORIGIN}/gate/?other=1`],
    ['duplicate language', `${ORIGIN}/gate/?lang=1&lang=1`],
    ['unsupported language', `${ORIGIN}/gate/?lang=3`],
    ['malformed query', `${ORIGIN}/gate/?lang=1&bad=%C0%AF`],
    ['fragment', `${ORIGIN}/gate/?lang=1#fragment`],
  ])('refuses %s before the next request without revealing the URL', async (_label, entry) => {
    const { result, calls } = await runMapping(entry);
    expect(result).toMatchObject({ success: false });
    expect(calls).toEqual([`${ORIGIN}/start`]);
    const message = JSON.stringify(result);
    expect(message).not.toContain(entry);
  });

  it('refuses a mapped path outside its destination allowlist', async () => {
    const op = { ...OP, url: [TARGET_RULES[1]] };
    const first: IGetStep = { ...FIRST, deriveCarry: [{ ...DERIVATION, op }] };
    const { result, calls } = await runMapping(`${ORIGIN}/gate/?lang=1`, first);
    expect(result).toMatchObject({ success: false });
    expect(calls).toEqual([`${ORIGIN}/start`]);
  });

  it.each([
    ['empty source rules', { ...DERIVATION, op: { ...OP, source: [] } }],
    ['empty target rules', { ...DERIVATION, op: { ...OP, url: [] } }],
    [
      'insecure source',
      {
        ...DERIVATION,
        op: { ...OP, source: [{ origin: 'http://bank.example', paths: ['/gate/'] }] },
      },
    ],
    ['blank selector', { ...DERIVATION, op: { ...OP, key: '' } }],
    ['empty map', { ...DERIVATION, op: { ...OP, paths: {} } }],
    ['unsafe map path', { ...DERIVATION, op: { ...OP, paths: { '1': '/gate/?oops=1' } } }],
    ['no source part', { ...DERIVATION, parts: [] }],
    ['multiple source parts', { ...DERIVATION, parts: ['carry.entry', 'carry.entry'] }],
    ['text transformation', { ...DERIVATION, transform: 'lower' }],
    ['source truncation', { ...DERIVATION, truncateBytes: 32 }],
  ] as const)('rejects %s at build time', (_label, derived) => {
    const call: IApiDirectCallConfig = { ...CONFIG, steps: [{ ...FIRST, deriveCarry: [derived] }] };
    const result = validateApiDirectConfig({ call, transport: HEADLESS });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'derive.op.url-path-map: invalid mapping',
    });
  });

  it('rejects another unchecked writer of the mapped slot', () => {
    const unchecked = { into: 'target', parts: ['creds.url'] } as const;
    const first: IGetStep = { ...FIRST, deriveCarry: [DERIVATION, unchecked] };
    const call = { ...CONFIG, steps: [first, NEXT] };
    const result = validateApiDirectConfig({ call, transport: HEADLESS });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'steps.urlFromCarry: slot needs an earlier url rule',
    });
  });

  it('rechecks the carried destination immediately before the GET', async () => {
    const fake = fakeFetch(() => Response.json({}));
    globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
    const bus = makeNativeMediator(CompanyTypes.OneZero, ORIGIN);
    const scope = {
      carry: { entry: `${ORIGIN}/gate/?lang=1` },
      creds: {},
      config: CONFIG,
      keypair: undefined,
    };
    const first = await runStep({ step: FIRST, scope, bus, companyId: CompanyTypes.OneZero });
    expect(first.success).toBe(true);
    if (first.success) {
      const changed = {
        ...first.value,
        carry: { ...first.value.carry, target: 'https://foreign.example/gate/he/?lang=1' },
      };
      const carriedUrlRules = carriedUrlRulesOf(CONFIG.steps, 1);
      const next = await runStep({
        step: NEXT,
        scope: changed,
        bus,
        companyId: CompanyTypes.OneZero,
        carriedUrlRules,
      });
      expect(next).toMatchObject({ success: false });
    }
    const calls = fake.calls.map(call => call.url);
    expect(calls).toEqual([`${ORIGIN}/start`]);
  });
});
