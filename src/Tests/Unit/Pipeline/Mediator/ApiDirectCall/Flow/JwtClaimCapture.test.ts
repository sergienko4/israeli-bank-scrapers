/**
 * Issued-token claims must bind to the current flow before handoff.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { validateApiDirectConfig } from '../../../../../../Scrapers/Pipeline/Core/Builder/Validation/ApiDirectConfigRules.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
  IJwtClaimsCapture,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/RunStep.js';
import { runSmsOtpFlow } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/SmsOtpFlow.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { fakeFetch } from '../../../../../Helpers/FakeFetch.js';
import { makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';

const ORIGIN = 'https://bank.example';
const USER = 'synthetic-user';
const TRACKING = 'synthetic-routing';
const SECRET = 'synthetic-private-claim';
const CAPTURE = {
  kind: 'jwt-claims',
  from: 'token',
  maxTokenChars: 32768,
  equals: {
    '/IdBlockObject/LeumiAuth/Uid': 'creds.username',
    '/params/trackingCode': 'carry.tracking',
    '/params/sysNum': 'carry.system',
    '/params/langNum': 'carry.language',
  },
  captures: {
    site: { pointer: '/IdBlockObject/LeumiAuth/Site', maxChars: 8 },
    jti: { pointer: '/jti', maxChars: 128 },
  },
} as const;
const TRANSPORT = {
  identityBase: ORIGIN,
  graphql: `${ORIGIN}/graphql`,
  paths: {},
  nativeFetch: true,
};
const BASE: IGetStep = {
  name: 'bind',
  urlTag: 'auth.bind',
  method: 'GET',
  extractsToCarry: { token: '/token' },
  deriveCarry: [{ into: 'siteCopy', parts: ['carry.site'] }],
};

/**
 * Constructs a compact synthetic token without a real signing key.
 * @param payload - Claims under test.
 * @returns A three-segment token.
 */
function tokenOf(payload: object): string {
  const header = Buffer.from('{"alg":"RS256"}').toString('base64url');
  const json = JSON.stringify(payload);
  const body = Buffer.from(json).toString('base64url');
  const signature = Buffer.from('synthetic-signature').toString('base64url');
  return `${header}.${body}.${signature}`;
}

/**
 * Constructs claims bound to the synthetic flow.
 * @returns Fresh claims.
 */
function claims(): object {
  return {
    exp: Math.floor(Date.now() / 1000) + 3600,
    IdBlockObject: { LeumiAuth: { Uid: USER, Site: '40' } },
    params: { trackingCode: TRACKING, sysNum: '23', langNum: '1' },
    jti: SECRET,
  };
}

/**
 * Installs an untrusted capture config on the step.
 * @param capture - Candidate capture.
 * @returns Step under test.
 */
function stepWith(capture: object): IGetStep {
  const step = { ...BASE };
  Reflect.set(step, 'structuredCapture', capture);
  return step;
}

/**
 * Wraps one step in its flow config.
 * @param step - Step under test.
 * @returns Synthetic flow.
 */
function configFor(step: IGetStep): IApiDirectCallConfig {
  return { flow: 'sms-otp', envelope: {}, steps: [step] };
}

/**
 * Runs the real step path against a synthetic token response.
 * @param token - Untrusted token.
 * @param capture - Claim capture policy.
 * @returns The result and fake request record.
 */
async function runToken(
  token: string,
  capture: IJwtClaimsCapture = CAPTURE,
): Promise<{
  result: Awaited<ReturnType<typeof runStep>>;
  calls: number;
}> {
  const step: IGetStep = { ...BASE, structuredCapture: capture };
  const config = configFor(step);
  const fake = fakeFetch(() => Response.json({ token }));
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  const bus = makeNativeMediator(CompanyTypes.OneZero, ORIGIN);
  const carry = { tracking: TRACKING, system: '23', language: '1' };
  const scope = { carry, creds: { username: USER }, config, keypair: undefined };
  const result = await runStep({ step, scope, bus, companyId: CompanyTypes.OneZero });
  return { result, calls: fake.calls.length };
}

describe('issued JWT claim capture', () => {
  const originalFetch = globalThis.fetch;
  beforeAll(() => {
    registerWkUrl('auth.bind', CompanyTypes.OneZero, `${ORIGIN}/assert`);
    registerWkUrl('auth.login', CompanyTypes.OneZero, `${ORIGIN}/handoff`);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('binds the newly extracted token and makes its site available to derivation', async () => {
    const step: IGetStep = { ...BASE, structuredCapture: CAPTURE };
    const config = configFor(step);
    const valid = validateApiDirectConfig({ transport: TRANSPORT, call: config });
    expect(valid.success).toBe(true);
    const payload = claims();
    const token = tokenOf(payload);
    const { result } = await runToken(token);
    expect(result).toMatchObject({
      success: true,
      value: { carry: { site: '40', jti: SECRET, siteCopy: '40' } },
    });
  });

  it('only rejects blank captured text when explicitly requested', async () => {
    const token = tokenOf({ ...claims(), jti: '   ' });
    const capture = {
      ...CAPTURE,
      captures: { ...CAPTURE.captures, jti: { ...CAPTURE.captures.jti, rejectBlank: true } },
    } as const;
    const unchanged = await runToken(token);
    const guarded = await runToken(token, capture);
    expect(unchanged.result.success).toBe(true);
    expect(guarded.result).toMatchObject({ success: false, errorMessage: 'jwt claims invalid' });
  });

  it('preserves nonblank captured text when the blank guard is enabled', async () => {
    const token = tokenOf({ ...claims(), jti: ' value ' });
    const capture = {
      ...CAPTURE,
      captures: { ...CAPTURE.captures, jti: { ...CAPTURE.captures.jti, rejectBlank: true } },
    } as const;
    const { result } = await runToken(token, capture);
    expect(result).toMatchObject({ success: true, value: { carry: { jti: ' value ' } } });
  });

  it.each([
    ['UID', { IdBlockObject: { LeumiAuth: { Uid: 'foreign-user', Site: '40' } } }],
    ['tracking', { params: { trackingCode: 'foreign', sysNum: '23', langNum: '1' } }],
    ['system', { params: { trackingCode: TRACKING, sysNum: '24', langNum: '1' } }],
    ['language', { params: { trackingCode: TRACKING, sysNum: '23', langNum: '2' } }],
    ['expired', { exp: 1 }],
    ['fractional expiry', { exp: 9999999999.5 }],
    ['string expiry', { exp: '9999999999' }],
    ['missing expiry', { exp: null }],
    ['missing site', { IdBlockObject: { LeumiAuth: { Uid: USER } } }],
    ['oversized jti', { jti: 'x'.repeat(129) }],
  ])('refuses %s without exposing claims or token', async (_label, change) => {
    const payload = { ...claims(), ...change };
    const token = tokenOf(payload);
    const { result, calls } = await runToken(token);
    expect(result).toMatchObject({ success: false });
    expect(calls).toBe(1);
    const output = JSON.stringify(result);
    expect(output).not.toContain(token);
    expect(output).not.toContain(SECRET);
  });

  it.each(['not-a-jwt', 'e30.e30.', 'e30.e30.!', 'e30.e30.Zh', 'x'.repeat(32769)])(
    'refuses a malformed or oversized token without exposing it',
    async token => {
      const { result } = await runToken(token);
      expect(result).toMatchObject({ success: false });
      const output = JSON.stringify(result);
      expect(output).not.toContain(token);
    },
  );

  it('refuses duplicate decoded claim keys even when the last value matches', async () => {
    const payload = claims();
    const token = tokenOf(payload);
    const parts = token.split('.');
    const json = JSON.stringify(payload);
    const repeated = json.replace(`"Uid":"${USER}"`, `"Uid":"foreign-user","U\\u0069d":"${USER}"`);
    expect(repeated).not.toBe(json);
    parts[1] = Buffer.from(repeated).toString('base64url');
    const ambiguous = parts.join('.');
    const { result } = await runToken(ambiguous);
    expect(result).toMatchObject({ success: false });
    const output = JSON.stringify(result);
    expect(output).not.toContain(ambiguous);
    expect(output).not.toContain(SECRET);
  });

  it('refuses invalid UTF-8 in the encoded payload', async () => {
    const payload = claims();
    const token = tokenOf(payload);
    const parts = token.split('.');
    parts[1] = Buffer.from([0xff]).toString('base64url');
    const invalid = parts.join('.');
    const { result } = await runToken(invalid);
    expect(result).toMatchObject({ success: false });
  });

  it.each([
    ['mismatched UID', { uid: 'foreign-user', isSuccess: false, calls: 1 }],
    ['matching UID', { uid: USER, isSuccess: true, calls: 2 }],
  ])('stops the real step reducer before handoff on %s', async (_label, scenario) => {
    const { uid, isSuccess, calls } = scenario;
    const payload = { ...claims(), IdBlockObject: { LeumiAuth: { Uid: uid, Site: '40' } } };
    const token = tokenOf(payload);
    const first: IGetStep = { ...BASE, structuredCapture: CAPTURE };
    const next: IGetStep = {
      name: 'login',
      urlTag: 'auth.login',
      method: 'GET',
      extractsToCarry: {},
    };
    const config: IApiDirectCallConfig = {
      ...configFor(first),
      steps: [first, next],
      seedCarryFromCreds: ['tracking', 'system', 'language'],
    };
    const fake = fakeFetch(() => Response.json({ token }));
    globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
    const bus = makeNativeMediator(CompanyTypes.OneZero, ORIGIN);
    const creds = { username: USER, tracking: TRACKING, system: '23', language: '1' };
    const result = await runSmsOtpFlow({ config, bus, creds, companyId: CompanyTypes.OneZero });
    expect(result.success).toBe(isSuccess);
    expect(fake.calls).toHaveLength(calls);
  });

  it.each([
    ['missing token source', { from: '' }],
    ['invalid token limit', { maxTokenChars: 0 }],
    ['bad assertion pointer', { equals: { invalid: 'creds.username' } }],
    ['bad assertion ref', { equals: { '/uid': 'not-a-ref' } }],
    ['bad capture bound', { captures: { site: { pointer: '/site', maxChars: 0 } } }],
    [
      'invalid blank guard',
      { captures: { site: { pointer: '/site', maxChars: 8, rejectBlank: false } } },
    ],
    ['token output collision', { captures: { token: { pointer: '/site', maxChars: 8 } } }],
  ])('rejects %s at build time', (_label, change) => {
    const step = stepWith({ ...CAPTURE, ...change });
    const call = configFor(step);
    const result = validateApiDirectConfig({ transport: TRANSPORT, call });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'steps.structuredCapture: invalid capture',
    });
  });

  it('does not admit an issued claim as a checked carried URL', () => {
    const first = stepWith(CAPTURE);
    const next: IGetStep = {
      name: 'login',
      urlTag: 'auth.login',
      method: 'GET',
      urlFromCarry: 'site',
      extractsToCarry: {},
    };
    const call = { ...configFor(first), steps: [first, next] };
    const result = validateApiDirectConfig({ transport: TRANSPORT, call });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'steps.urlFromCarry: slot needs an earlier url rule',
    });
  });

  it('rejects a claim output that collides with a step derivation', () => {
    const capture = { ...CAPTURE, captures: { siteCopy: { pointer: '/jti', maxChars: 128 } } };
    const step = stepWith(capture);
    const call = configFor(step);
    const result = validateApiDirectConfig({ transport: TRANSPORT, call });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'steps.structuredCapture: must be a fresh slot',
    });
  });
});
