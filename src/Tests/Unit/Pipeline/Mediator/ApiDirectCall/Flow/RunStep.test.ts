/**
 * Unit tests for RunStep — generic per-step runner. Exercises the
 * 4 outcomes: happy, body-hydrate fail, apiPost fail, carry-extract
 * fail. Covers both signer-present and signer-absent branches.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type { IGenericKeypair } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import { generateKeypair } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CryptoKeyFactory.js';
import type { JsonValue } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import type { WKUrlGroup } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { fail, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';

/** Reusable config stub — signer-present shape mirrors Pepper's surface. */
const SIGNER_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: {},
  staticHeaders: { 'X-Static': 'yes' },
  signer: {
    algorithm: 'ECDSA-P256',
    encoding: 'DER',
    headerName: 'Content-Signature',
    schemeTag: 4,
    canonical: {
      parts: ['bodyJson'],
      separator: '%%',
      escapeFrom: '%%',
      escapeTo: String.raw`\%`,
      sortQueryParams: false,
      clientVersion: '1.2.3',
    },
  },
};

/** Reusable config stub — signer-absent. */
const PLAIN_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: {},
};

/** Arbitrary WK tag we'll register for this test suite's fake bank. */
const TEST_URL_TAG: WKUrlGroup = 'auth.bind';
const TEST_HINT = CompanyTypes.OneZero;

beforeAll((): void => {
  registerWkUrl(TEST_URL_TAG, TEST_HINT, 'https://example.test/api/bind?v=1');
});

/**
 * Build a generic happy-path step — body hydrates to a fixed object
 * and extracts "challenge" from the response.
 * @returns Step config.
 */
function makeStep(): IStepConfig {
  return {
    name: 'bind',
    urlTag: TEST_URL_TAG,
    body: {
      shape: {
        hello: { $literal: 'world' },
      },
    },
    extractsToCarry: { challenge: '/data/challenge' },
  };
}

/**
 * Build a scope that points at the chosen config.
 * @param config - Config stub.
 * @param keypair - Optional keypair (for signer tests).
 * @returns Template scope.
 */
function makeScope(config: IApiDirectCallConfig, keypair?: IGenericKeypair): ITemplateScope {
  return {
    carry: {},
    creds: { password: 'p' },
    config,
    keypair: keypair === undefined ? undefined : { ec: keypair },
  };
}

/**
 * Minimal generator for a test keypair (only used to exercise the
 * signer branch; test does not verify the signature bytes).
 * @returns IGenericKeypair.
 */
function makeKeypair(): IGenericKeypair {
  const proc = generateKeypair('ECDSA-P256');
  if (!proc.success) throw new ScraperError('keypair gen failed');
  return proc.value;
}

describe('api-direct-call RunStep happy path no signer', () => {
  it('hydrates body, fires apiPost, merges carry, returns next scope', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const response: JsonValue = { data: { challenge: 'abc' } };
    const responses = [succeed(response)];
    const bus = makeStubMediator({ responses, captures });
    const scope = makeScope(PLAIN_CONFIG);
    const result = await runStep({ step: makeStep(), bus, scope, companyId: TEST_HINT });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('runStep should succeed');
    expect(captures).toHaveLength(1);
    expect(captures[0].url).toBe(TEST_URL_TAG);
    expect(captures[0].body).toEqual({ hello: 'world' });
    expect(captures[0].extraHeaders).toEqual({});
    expect(result.value.carry.challenge).toBe('abc');
  });
});

describe('api-direct-call RunStep happy path with signer + staticHeaders', () => {
  it('attaches signer header + static headers on the outbound call', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const response: JsonValue = { data: { challenge: 'xyz' } };
    const responses = [succeed(response)];
    const bus = makeStubMediator({ responses, captures });
    const keypair = makeKeypair();
    const scope = makeScope(SIGNER_CONFIG, keypair);
    const result = await runStep({
      step: makeStep(),
      bus,
      scope,
      companyId: TEST_HINT,
      signingKeypair: keypair,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('runStep should succeed');
    expect(captures[0].extraHeaders).toBeDefined();
    const headers = captures[0].extraHeaders ?? {};
    expect(headers['X-Static']).toBe('yes');
    expect(headers['Content-Signature']).toMatch(/^data:.+;key-id:[a-f0-9]+;scheme:4$/);
    expect(result.value.carry.challenge).toBe('xyz');
  });
});

describe('api-direct-call RunStep signer configured but keypair absent', () => {
  it('fails with the signer-keypair-missing message', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({})];
    const bus = makeStubMediator({ responses, captures });
    const scope = makeScope(SIGNER_CONFIG);
    const result = await runStep({ step: makeStep(), bus, scope, companyId: TEST_HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('signing keypair');
    expect(captures).toHaveLength(0);
  });
});

describe('api-direct-call RunStep body hydrate failure', () => {
  it('propagates fail when a $ref cannot resolve', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({})];
    const bus = makeStubMediator({ responses, captures });
    const badStep: IStepConfig = {
      name: 'bind',
      urlTag: TEST_URL_TAG,
      body: { shape: { thing: { $ref: 'carry.nope' } } },
      extractsToCarry: {},
    };
    const scope = makeScope(PLAIN_CONFIG);
    const result = await runStep({ step: badStep, bus, scope, companyId: TEST_HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('carry.nope');
    expect(captures).toHaveLength(0);
  });
});

describe('api-direct-call RunStep apiPost failure', () => {
  it('propagates the apiPost failure verbatim', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [fail(ScraperErrorTypes.Generic, 'transport boom')];
    const bus = makeStubMediator({ responses, captures });
    const scope = makeScope(PLAIN_CONFIG);
    const result = await runStep({ step: makeStep(), bus, scope, companyId: TEST_HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('transport boom');
  });
});

describe('api-direct-call RunStep carry extract failure', () => {
  it('fails when extractsToCarry points at an absent field', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ data: {} })];
    const bus = makeStubMediator({ responses, captures });
    const scope = makeScope(PLAIN_CONFIG);
    const step: IStepConfig = {
      ...makeStep(),
      extractsToCarry: { challenge: '/data/challenge' },
    };
    const result = await runStep({ step, bus, scope, companyId: TEST_HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('envelope selector miss');
  });
});

describe('api-direct-call RunStep unknown WK url with signer', () => {
  it('fails when resolveWkUrl cannot find the tag', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({})];
    const bus = makeStubMediator({ responses, captures });
    const keypair = makeKeypair();
    const scope = makeScope(SIGNER_CONFIG, keypair);
    const step: IStepConfig = { ...makeStep(), urlTag: 'auth.logout' };
    const result = await runStep({
      step,
      bus,
      scope,
      companyId: TEST_HINT,
      signingKeypair: keypair,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('unknown WK url');
  });
});
