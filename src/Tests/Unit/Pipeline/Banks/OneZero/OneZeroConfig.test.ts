/**
 * Integration test for the OneZero API-direct call-config literal.
 *
 * Pins the warm-start contract the mediator consumes: the persisted warm
 * artifact is the ~10-year idToken minted by getIdToken (NOT the 1-hour
 * otpToken produced mid-chain), seeded into carry.idToken so only the
 * sessionToken step re-runs. The behavioural cases prove it at the
 * strategy level: a warm prime fires exactly one apiPost
 * (identity.sessionToken) whose body carries the seeded idToken + the
 * caller's password, and the captured long-term token round-trips the
 * same idToken; a cold prime still runs all 5 steps in order.
 *
 * Uses dynamic imports for `Registry/Config/*` per the project's
 * test architectural rule (Pipeline tests don't statically import
 * from Registry/Config — same pattern as
 * `PayBox/PayBoxConfig.test.ts`).
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  createTokenStrategyFromConfig,
  type GenericCreds,
  type IConfigTokenStrategy,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import type { WKUrlGroup } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { registerWkUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  type IApiPostCapture,
  makeStubMediator,
} from '../../Mediator/ApiDirectCall/Flow/StubMediator.js';

const CONFIG_PATH = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigOneZero.js';
const HINT = CompanyTypes.OneZero;

/** Identity urlTags the OneZero flow resolves, in step order. */
const STEP_TAGS: readonly WKUrlGroup[] = [
  'identity.deviceToken',
  'identity.otpPrepare',
  'identity.otpVerify',
  'identity.getIdToken',
  'identity.sessionToken',
];

beforeAll((): void => {
  for (const tag of STEP_TAGS) registerWkUrl(tag, HINT, `https://example.test/api/${tag}`);
});

/** Module shape returned by the dynamic config import. */
interface IConfigModule {
  readonly ONEZERO_API_DIRECT_CALL: IApiDirectCallConfig;
}

/**
 * Load the OneZero call-config module via the permitted dynamic import.
 * @returns Promise resolving to the config module.
 */
async function loadConfig(): Promise<IConfigModule> {
  const mod = (await import(CONFIG_PATH)) as IConfigModule;
  return mod;
}

/** Synthetic idToken claims — ≈10-year validity window, zero real values. */
const ID_TOKEN_CLAIMS = Object.freeze({
  tokenType: 'idToken',
  deviceId: '00000000-0000-4000-8000-000000000000',
  userId: 'syn-user',
  identitySessionId: 'syn-session',
  clientId: 'mobile',
  iat: 1_800_000_000,
  exp: 2_115_576_000,
});

/**
 * Build a syntactically valid idToken-shaped JWT. The signature segment
 * is garbage on purpose — nothing verifies it client-side.
 * @returns Compact JWT string.
 */
function makeSyntheticIdToken(): string {
  const headerJson = JSON.stringify({ alg: 'RS256', typ: 'JWT' });
  const headerEnc = Buffer.from(headerJson).toString('base64url');
  const payloadJson = JSON.stringify(ID_TOKEN_CLAIMS);
  const payloadEnc = Buffer.from(payloadJson).toString('base64url');
  return `${headerEnc}.${payloadEnc}.syn-signature`;
}

/** Base synthetic creds — the cold case adds an OTP retriever inline. */
const BASE_CREDS: GenericCreds = {
  email: 'syn-onezero@example.test',
  password: 'syn-pass',
  phoneNumber: '+972000000000',
};

/** Minimal pipeline-context stub — only companyId matters. */
const CTX_STUB = { companyId: HINT } as unknown as IPipelineContext;

/**
 * Build the config-driven strategy, unwrapping the factory procedure.
 * @param config - OneZero config literal.
 * @returns The ready strategy.
 */
function makeStrategy(config: IApiDirectCallConfig): IConfigTokenStrategy {
  const result = createTokenStrategyFromConfig({ config });
  if (!result.success) throw new ScraperError('factory should succeed');
  return result.value;
}

/**
 * Fake OTP retriever — the cold path's assertOtp preHook awaits it.
 * @returns Synthetic OTP code.
 */
function fakeOtpRetriever(): Promise<string> {
  return Promise.resolve('024681');
}

/**
 * Scripted cold-path responses for the 5 OneZero steps, in step order.
 * @param idToken - idToken the getIdToken step mints.
 * @returns Response procedures fed to the stub mediator.
 */
function coldResponses(idToken: string): readonly Procedure<unknown>[] {
  return [
    succeed({ resultData: { deviceToken: 'syn-device' } }),
    succeed({ resultData: { otpContext: 'syn-ctx' } }),
    succeed({ resultData: { otpToken: 'syn-otp' } }),
    succeed({ resultData: { idToken } }),
    succeed({ resultData: { accessToken: 'syn-access-cold' } }),
  ];
}

describe('ONEZERO_API_DIRECT_CALL — warm-start contract', () => {
  it('seeds the 10-year idToken and starts at the sessionToken step', async () => {
    const mod = await loadConfig();
    expect(mod.ONEZERO_API_DIRECT_CALL.warmStart).toEqual({
      credsField: 'otpLongTermToken',
      carryField: 'idToken',
      fromStepIndex: 4,
    });
  });

  it('declares the 5 login steps in order, sessionToken last + bearer extraction', async () => {
    const mod = await loadConfig();
    const steps = mod.ONEZERO_API_DIRECT_CALL.steps;
    const names = steps.map(step => step.name);
    expect(names).toEqual(['bind', 'assertPassword', 'assertOtp', 'getIdToken', 'sessionToken']);
    const last = steps[4];
    expect(last.urlTag).toBe('identity.sessionToken');
    expect(last.extractsToCarry).toEqual({ token: '/resultData/accessToken' });
  });

  it('sessionToken body refs the seeded carry.idToken + creds.password', async () => {
    const mod = await loadConfig();
    const last = mod.ONEZERO_API_DIRECT_CALL.steps[4];
    expect(last.body.shape).toEqual({
      idToken: { $ref: 'carry.idToken' },
      pass: { $ref: 'creds.password' },
    });
  });

  it('getIdToken extracts the idToken the warm path later reuses', async () => {
    const mod = await loadConfig();
    const step = mod.ONEZERO_API_DIRECT_CALL.steps[3];
    expect(step.urlTag).toBe('identity.getIdToken');
    expect(step.extractsToCarry).toEqual({ idToken: '/resultData/idToken' });
  });
});

describe('ONEZERO warm start — idToken seed', () => {
  it('fires exactly one apiPost (sessions/token) and round-trips the idToken', async () => {
    const mod = await loadConfig();
    const strategy = makeStrategy(mod.ONEZERO_API_DIRECT_CALL);
    const idToken = makeSyntheticIdToken();
    const captures: IApiPostCapture[] = [];
    const warmResponse = succeed({ resultData: { accessToken: 'syn-access-warm' } });
    const bus = makeStubMediator({ responses: [warmResponse], captures });
    const creds: GenericCreds = { ...BASE_CREDS, otpLongTermToken: idToken };
    const proc = await strategy.primeInitial(bus, CTX_STUB, creds);
    if (!proc.success) throw new ScraperError('warm prime should succeed');
    expect(proc.value).toBe('Bearer syn-access-warm');
    expect(captures).toHaveLength(1);
    expect(captures[0].url).toBe('identity.sessionToken');
    expect(captures[0].body).toEqual({ idToken, pass: BASE_CREDS.password });
    const longTerm = strategy.getLatestLongTermToken();
    expect(longTerm).toBe(idToken);
    const wasWarm = strategy.lastPrimeWasWarm();
    expect(wasWarm).toBe(true);
  });

  it('cold prime (no stored token) still runs all 5 steps in order', async () => {
    const mod = await loadConfig();
    const strategy = makeStrategy(mod.ONEZERO_API_DIRECT_CALL);
    const idToken = makeSyntheticIdToken();
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: coldResponses(idToken), captures });
    const creds: GenericCreds = { ...BASE_CREDS, otpCodeRetriever: fakeOtpRetriever };
    const proc = await strategy.primeInitial(bus, CTX_STUB, creds);
    if (!proc.success) throw new ScraperError('cold prime should succeed');
    expect(proc.value).toBe('Bearer syn-access-cold');
    const firedTags = captures.map(capture => capture.url);
    expect(firedTags).toEqual(STEP_TAGS);
    expect(captures[3].body).toEqual({
      otpSmsToken: 'syn-otp',
      email: BASE_CREDS.email,
      pass: BASE_CREDS.password,
      pinCode: '',
    });
    expect(captures[4].body).toEqual({ idToken, pass: BASE_CREDS.password });
    const longTerm = strategy.getLatestLongTermToken();
    expect(longTerm).toBe(idToken);
    const wasWarm = strategy.lastPrimeWasWarm();
    expect(wasWarm).toBe(false);
  });
});
