/**
 * Unit tests for Core/HeadlessMediatorWiring.resolveHeadlessApiMediator — the
 * transport selector. Asserts: a non-headless descriptor yields none(); a
 * headless bank with no headless config yields none(); OneZero (requiresClientCert)
 * yields a mTLS-backed mediator; PayBox (native fetch) yields a Node-fetch-backed
 * mediator, and a PayBox phoneValidate POST reaches the configured URL through
 * a stubbed globalThis.fetch. No network is performed.
 */

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import {
  resolveHeadlessApiMediator,
  resolveHeadlessTransportKind,
} from '../../../../Scrapers/Pipeline/Core/HeadlessMediatorWiring.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import { isSome } from '../../../../Scrapers/Pipeline/Types/Option.js';

const PHONE_VALIDATE_URL = 'https://apipin.payboxapp.com/api/2.0/phoneValidate';
const PHONE_VALIDATE_BODY = { phoneNum: '+972-50-0000000', isVoiceCall: false };
const PHONE_VALIDATE_REPLY = { code: 0, content: { access_token: 'synthetic-access-token' } };

/**
 * Build a minimal descriptor for a bank with the given headless flag.
 * @param companyId - Target bank company type.
 * @param isHeadless - Whether the pipeline is headless (API-only).
 * @returns A descriptor sufficient for the wiring lookup.
 */
function makeDescriptor(companyId: CompanyTypes, isHeadless: boolean): IPipelineDescriptor {
  const options = { companyId } as unknown as ScraperOptions;
  return { options, phases: [], interceptors: [], isHeadless };
}

describe('resolveHeadlessApiMediator — none() cases', () => {
  it('returns none() when the descriptor is not headless', () => {
    const descriptor = makeDescriptor(CompanyTypes.OneZero, false);
    const option = resolveHeadlessApiMediator(descriptor);
    const isPresent = isSome(option);
    expect(isPresent).toBe(false);
  });

  it('returns none() when a headless bank has no headless config block', async () => {
    const registry =
      await import('../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const bank = CompanyTypes.Leumi;
    const original = registry.PIPELINE_BANK_CONFIG[bank];
    if (original === undefined) throw new TypeError('missing bank configuration');
    const { headless, ...withoutHeadless } = original;
    expect(headless).toBeDefined();
    registry.PIPELINE_BANK_CONFIG[bank] = withoutHeadless;
    try {
      const descriptor = makeDescriptor(bank, true);
      const option = resolveHeadlessApiMediator(descriptor);
      const isPresent = isSome(option);
      expect(isPresent).toBe(false);
    } finally {
      registry.PIPELINE_BANK_CONFIG[bank] = original;
    }
  });
});

describe('resolveHeadlessApiMediator — some(mediator) cases', () => {
  it('wires a mTLS mediator for OneZero (requiresClientCert)', () => {
    const descriptor = makeDescriptor(CompanyTypes.OneZero, true);
    const option = resolveHeadlessApiMediator(descriptor);
    const isPresent = isSome(option);
    expect(isPresent).toBe(true);
    if (isSome(option)) {
      expect(typeof option.value.apiPost).toBe('function');
      expect(typeof option.value.apiQuery).toBe('function');
    }
  });

  it('wires a Node-fetch mediator for PayBox (nativeFetch)', () => {
    const descriptor = makeDescriptor(CompanyTypes.PayBox, true);
    const option = resolveHeadlessApiMediator(descriptor);
    const isPresent = isSome(option);
    expect(isPresent).toBe(true);
    if (isSome(option)) {
      expect(typeof option.value.apiPost).toBe('function');
      expect(option.value.drivesBrowser).toBeUndefined();
    }
  });
});

describe('resolveHeadlessApiMediator — PayBox native transport', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts phoneValidate to the configured PayBox URL through Node fetch', async () => {
    const headers = { 'content-type': 'application/json' };
    const answer = new Response(JSON.stringify(PHONE_VALIDATE_REPLY), { status: 200, headers });
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(answer);
    const descriptor = makeDescriptor(CompanyTypes.PayBox, true);
    const option = resolveHeadlessApiMediator(descriptor);
    if (!isSome(option)) throw new TypeError('PayBox resolved no mediator');
    const result = await option.value.apiPost('identity.phoneValidate', PHONE_VALIDATE_BODY);
    expect(result).toEqual({ success: true, value: PHONE_VALIDATE_REPLY });
    const [url, init] = fetch.mock.calls[0];
    const expectedBody = JSON.stringify(PHONE_VALIDATE_BODY);
    expect(url).toBe(PHONE_VALIDATE_URL);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(expectedBody);
  });
});

describe('resolveHeadlessTransportKind — Pepper and PayBox', () => {
  it.each([CompanyTypes.Pepper, CompanyTypes.PayBox])('selects native for %s', companyId => {
    const kind = resolveHeadlessTransportKind(companyId);
    expect(kind).toBe('native');
  });
});
