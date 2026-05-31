/**
 * Unit tests for TokenStrategyFromConfig — generic config-driven
 * ITokenStrategy. Covers warmStart short-circuit (no steps),
 * warmStart partial (steps from fromStepIndex run), cold fallthrough
 * when no warm seed, JWT freshness gate, primeFresh always-flow,
 * authScheme=bearer, hasWarmState, unsupported-flow fail.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import {
  createTokenStrategyFromConfig,
  type GenericCreds,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { WKUrlGroup } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { IPipelineContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';

const ASSERT_TAG: WKUrlGroup = 'auth.assert';
const HINT = CompanyTypes.OneZero;

beforeAll((): void => {
  registerWkUrl(ASSERT_TAG, HINT, 'https://example.test/api/assert-tsfc');
});

/**
 * Build a base single-step config where the step extracts
 * carry.token from the response.
 * @returns Config literal.
 */
function makeSingleStepConfig(): IApiDirectCallConfig {
  return {
    flow: 'sms-otp',
    envelope: {},
    probe: {},
    steps: [
      {
        name: 'getIdToken',
        urlTag: ASSERT_TAG,
        body: { shape: {} },
        extractsToCarry: { token: '/access_token' },
      },
    ],
  };
}

/**
 * Build a synthetic JWT with a configurable exp claim offset.
 * @param deltaSec - Seconds from now for the exp claim.
 * @returns Compact JWT.
 */
function makeJwt(deltaSec: number): string {
  const headerJson = JSON.stringify({ alg: 'none' });
  const headerEnc = Buffer.from(headerJson).toString('base64url');
  const expSec = Math.floor(Date.now() / 1000) + deltaSec;
  const payloadJson = JSON.stringify({ exp: expSec });
  const payloadEnc = Buffer.from(payloadJson).toString('base64url');
  return `${headerEnc}.${payloadEnc}.sig`;
}

/** Minimal pipeline-context stub — only companyId matters. */
const CTX_STUB = { companyId: HINT } as unknown as IPipelineContext;

describe('api-direct-call createTokenStrategyFromConfig warmStart full short-circuit', () => {
  it('returns stored token verbatim without firing apiPost (fromStepIndex=steps.length)', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    const cfg: IApiDirectCallConfig = {
      ...makeSingleStepConfig(),
      warmStart: { credsField: 'storedJwt', carryField: 'token', fromStepIndex: 1 },
      jwtClaims: { freshnessField: 'exp', skewSeconds: 60 },
    };
    const result = createTokenStrategyFromConfig({ config: cfg });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('factory should succeed');
    const storedJwt = makeJwt(3600);
    const creds: GenericCreds = { storedJwt };
    const proc = await result.value.primeInitial(bus, CTX_STUB, creds);
    expect(proc.success).toBe(true);
    if (proc.success) expect(proc.value).toBe(storedJwt);
    expect(captures).toHaveLength(0);
  });
});

describe('api-direct-call createTokenStrategyFromConfig warmStart expired falls through', () => {
  it('runs cold flow when stored JWT fails freshness gate', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ access_token: 'fresh-tok' })];
    const bus = makeStubMediator({ responses, captures });
    const cfg: IApiDirectCallConfig = {
      ...makeSingleStepConfig(),
      warmStart: { credsField: 'storedJwt', carryField: 'token', fromStepIndex: 1 },
      jwtClaims: { freshnessField: 'exp', skewSeconds: 60 },
    };
    const result = createTokenStrategyFromConfig({ config: cfg });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('factory should succeed');
    const creds: GenericCreds = { storedJwt: makeJwt(-10) };
    const proc = await result.value.primeInitial(bus, CTX_STUB, creds);
    expect(proc.success).toBe(true);
    if (proc.success) expect(proc.value).toBe('fresh-tok');
    expect(captures).toHaveLength(1);
  });
});

describe('api-direct-call createTokenStrategyFromConfig warmStart partial', () => {
  it('pre-seeds carry and iterates steps from fromStepIndex', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ data: { finalToken: 'sealed' } })];
    const bus = makeStubMediator({ responses, captures });
    const cfg: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      warmStart: { credsField: 'stored', carryField: 'otpToken', fromStepIndex: 1 },
      steps: [
        {
          name: 'bind',
          urlTag: ASSERT_TAG,
          body: { shape: {} },
          extractsToCarry: { otpToken: '/x' },
        },
        {
          name: 'getIdToken',
          urlTag: ASSERT_TAG,
          body: { shape: { fromOtp: { $ref: 'carry.otpToken' } } },
          extractsToCarry: { token: '/data/finalToken' },
        },
      ],
    };
    const result = createTokenStrategyFromConfig({ config: cfg });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('factory should succeed');
    const creds: GenericCreds = { stored: 'stored-otp-val' };
    const proc = await result.value.primeInitial(bus, CTX_STUB, creds);
    expect(proc.success).toBe(true);
    if (proc.success) expect(proc.value).toBe('sealed');
    expect(captures).toHaveLength(1);
    expect(captures[0].body).toEqual({ fromOtp: 'stored-otp-val' });
  });
});

describe('api-direct-call createTokenStrategyFromConfig no warmStart', () => {
  it('always runs cold flow, ignoring any creds field', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ access_token: 'cold-tok' })];
    const bus = makeStubMediator({ responses, captures });
    const result = createTokenStrategyFromConfig({ config: makeSingleStepConfig() });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('factory should succeed');
    const creds: GenericCreds = { storedJwt: 'anything' };
    const proc = await result.value.primeInitial(bus, CTX_STUB, creds);
    expect(proc.success).toBe(true);
    if (proc.success) expect(proc.value).toBe('cold-tok');
    expect(captures).toHaveLength(1);
  });
});

describe('api-direct-call createTokenStrategyFromConfig primeFresh', () => {
  it('ignores warmStart + stored token and runs full flow', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ access_token: 'from-fresh' })];
    const bus = makeStubMediator({ responses, captures });
    const cfg: IApiDirectCallConfig = {
      ...makeSingleStepConfig(),
      warmStart: { credsField: 'storedJwt', carryField: 'token', fromStepIndex: 1 },
      jwtClaims: { freshnessField: 'exp', skewSeconds: 60 },
    };
    const result = createTokenStrategyFromConfig({ config: cfg });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('factory should succeed');
    const creds: GenericCreds = { storedJwt: makeJwt(3600) };
    const proc = await result.value.primeFresh(bus, CTX_STUB, creds);
    expect(proc.success).toBe(true);
    if (proc.success) expect(proc.value).toBe('from-fresh');
    expect(captures).toHaveLength(1);
  });
});

describe('api-direct-call createTokenStrategyFromConfig authScheme bearer', () => {
  it('prefixes returned token with "Bearer "', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ access_token: 'xyz' })];
    const bus = makeStubMediator({ responses, captures });
    const cfg: IApiDirectCallConfig = { ...makeSingleStepConfig(), authScheme: 'bearer' };
    const result = createTokenStrategyFromConfig({ config: cfg });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('factory should succeed');
    const proc = await result.value.primeFresh(bus, CTX_STUB, {});
    expect(proc.success).toBe(true);
    if (proc.success) expect(proc.value).toBe('Bearer xyz');
  });
});

describe('api-direct-call createTokenStrategyFromConfig hasWarmState', () => {
  it('returns true only when warmStart configured + credsField populated', (): void => {
    const withWarm: IApiDirectCallConfig = {
      ...makeSingleStepConfig(),
      warmStart: { credsField: 'storedJwt', carryField: 'token', fromStepIndex: 1 },
    };
    const r1 = createTokenStrategyFromConfig({ config: withWarm });
    expect(r1.success).toBe(true);
    if (!r1.success) throw new ScraperError('factory should succeed');
    const isFilled = r1.value.hasWarmState({ storedJwt: 'anything' });
    expect(isFilled).toBe(true);
    const hasEmptyCreds = r1.value.hasWarmState({});
    expect(hasEmptyCreds).toBe(false);
    const hasEmptyString = r1.value.hasWarmState({ storedJwt: '' });
    expect(hasEmptyString).toBe(false);
    const r2 = createTokenStrategyFromConfig({ config: makeSingleStepConfig() });
    expect(r2.success).toBe(true);
    if (!r2.success) throw new ScraperError('factory should succeed');
    const hasNoWarm = r2.value.hasWarmState({ storedJwt: 'x' });
    expect(hasNoWarm).toBe(false);
  });
});

describe('api-direct-call createTokenStrategyFromConfig unsupported flow', () => {
  it('returns fail for non-"sms-otp" flow kinds', (): void => {
    const cfg: IApiDirectCallConfig = { ...makeSingleStepConfig(), flow: 'stored-jwt' };
    const result = createTokenStrategyFromConfig({ config: cfg });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('unsupported flow-kind');
  });
});

describe('api-direct-call createTokenStrategyFromConfig custom name', () => {
  it('uses the provided strategy name', (): void => {
    const result = createTokenStrategyFromConfig({
      config: makeSingleStepConfig(),
      name: 'MyBank',
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('factory should succeed');
    expect(result.value.name).toBe('MyBank');
  });
});
