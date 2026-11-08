/**
 * A structured JSON capture becomes available to the same step's derivations.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { validateApiDirectConfig } from '../../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { fakeFetch } from '../../../../../Helpers/FakeFetch.js';
import { makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';

const ORIGIN = 'https://bank.example';
const SESSION = '0123456789ABCDEF0123456789ABCDEF';
const CAPTURE = {
  kind: 'script-json',
  into: 'session',
  field: 'SessionID',
  pattern: '^[a-fA-F0-9]{32}$',
  maxChars: 32,
} as const;
const BASE: IGetStep = {
  name: 'bootstrap',
  urlTag: 'auth.bind',
  method: 'GET',
  response: 'text',
  extractsToCarry: {},
  deriveCarry: [{ into: 'copiedSession', parts: ['carry.session'] }],
};
const HEADLESS = {
  identityBase: ORIGIN,
  graphql: `${ORIGIN}/graphql`,
  paths: {},
  nativeFetch: true,
};

/**
 * Builds a step with an untrusted capture value.
 * @param capture - Candidate capture.
 * @returns The synthetic step.
 */
function stepWith(capture: object): IGetStep {
  const step = { ...BASE };
  Reflect.set(step, 'structuredCapture', capture);
  return step;
}

/**
 * Builds a minimal API-direct configuration.
 * @param step - Step under test.
 * @returns Its flow configuration.
 */
function configFor(step: IGetStep): IApiDirectCallConfig {
  return { flow: 'sms-otp', envelope: {}, steps: [step] };
}

describe('serialized JSON step capture', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('validates, captures and derives the root value on the real step path', async () => {
    const step = stepWith(CAPTURE);
    const config = configFor(step);
    const valid = validateApiDirectConfig({ headless: HEADLESS, call: config });
    expect(valid).toMatchObject({ success: true });
    registerWkUrl('auth.bind', CompanyTypes.OneZero, `${ORIGIN}/landing`);
    const json = JSON.stringify({ SessionID: SESSION });
    const data = JSON.stringify(json);
    const fake = fakeFetch(() => new Response(`<script>window.bootstrap=${data};</script>`));
    globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
    const bus = makeNativeMediator(CompanyTypes.OneZero, ORIGIN);
    const scope = { carry: {}, creds: {}, config, keypair: undefined };
    const result = await runStep({ step, scope, bus, companyId: CompanyTypes.OneZero });
    expect(result).toMatchObject({
      success: true,
      value: { carry: { session: SESSION, copiedSession: SESSION } },
    });
  });

  it.each([
    ['blank field', { field: '' }],
    ['zero maxChars', { maxChars: 0 }],
    ['unanchored pattern', { pattern: '[a-f]+' }],
    ['non-flat pattern', { pattern: '^(a+)+$' }],
  ])('refuses %s at build time', (_name, change) => {
    const step = stepWith({ ...CAPTURE, ...change });
    const result = validateApiDirectConfig({ headless: HEADLESS, call: configFor(step) });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'steps.structuredCapture: invalid capture',
    });
  });

  it('does not admit a JSON-captured value as a checked carried URL', () => {
    const first = stepWith(CAPTURE);
    const next: IGetStep = {
      name: 'prime',
      urlTag: 'auth.bind',
      method: 'GET',
      urlFromCarry: 'session',
      extractsToCarry: {},
    };
    const call = { ...configFor(first), steps: [first, next] };
    const result = validateApiDirectConfig({ headless: HEADLESS, call });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'steps.urlFromCarry: slot needs an earlier url rule',
    });
  });
});
