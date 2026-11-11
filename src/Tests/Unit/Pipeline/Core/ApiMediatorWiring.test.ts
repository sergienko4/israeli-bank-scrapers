/**
 * Unit tests for Core/ApiMediatorWiring.resolveApiMediator — the
 * transport selector. Asserts: a bank with no headless config yields none();
 * OneZero (requiresClientCert) yields a mTLS-backed mediator; PayBox (native
 * fetch) yields a Node-fetch-backed mediator, and a PayBox phoneValidate POST
 * reaches the configured URL through a stubbed globalThis.fetch. No network is
 * performed.
 */

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import {
  resolveApiMediator,
  resolveTransportKind,
} from '../../../../Scrapers/Pipeline/Core/ApiMediatorWiring.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import { isSome } from '../../../../Scrapers/Pipeline/Types/Option.js';

const PHONE_VALIDATE_URL = 'https://apipin.payboxapp.com/api/2.0/phoneValidate';
const PHONE_VALIDATE_BODY = { phoneNum: '+972-50-0000000', isVoiceCall: false };
const PHONE_VALIDATE_REPLY = { code: 0, content: { access_token: 'synthetic-access-token' } };

/**
 * Build a minimal descriptor for a bank.
 * @param companyId - Target bank company type.
 * @returns A descriptor sufficient for the wiring lookup.
 */
function makeDescriptor(companyId: CompanyTypes): IPipelineDescriptor {
  const options = { companyId } as unknown as ScraperOptions;
  return { options, phases: [] };
}

describe('resolveApiMediator — none() cases', () => {
  it('returns none() when a bank has no headless config block', async () => {
    const registry =
      await import('../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const bank = CompanyTypes.Leumi;
    const original = registry.PIPELINE_BANK_CONFIG[bank];
    if (original === undefined) throw new TypeError('missing bank configuration');
    const { transport: headless, ...withoutHeadless } = original;
    expect(headless).toBeDefined();
    registry.PIPELINE_BANK_CONFIG[bank] = withoutHeadless;
    try {
      const descriptor = makeDescriptor(bank);
      const option = resolveApiMediator(descriptor);
      const isPresent = isSome(option);
      expect(isPresent).toBe(false);
    } finally {
      registry.PIPELINE_BANK_CONFIG[bank] = original;
    }
  });
});

describe('resolveApiMediator — some(mediator) cases', () => {
  it('wires a mTLS mediator for OneZero (requiresClientCert)', () => {
    const descriptor = makeDescriptor(CompanyTypes.OneZero);
    const option = resolveApiMediator(descriptor);
    const isPresent = isSome(option);
    expect(isPresent).toBe(true);
    if (isSome(option)) {
      expect(typeof option.value.apiPost).toBe('function');
      expect(typeof option.value.apiQuery).toBe('function');
    }
  });

  it('wires a Node-fetch mediator for PayBox (nativeFetch)', () => {
    const descriptor = makeDescriptor(CompanyTypes.PayBox);
    const option = resolveApiMediator(descriptor);
    const isPresent = isSome(option);
    expect(isPresent).toBe(true);
    if (isSome(option)) {
      expect(typeof option.value.apiPost).toBe('function');
    }
  });
});

describe('resolveApiMediator — PayBox native transport', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts phoneValidate to the configured PayBox URL through Node fetch', async () => {
    const headers = { 'content-type': 'application/json' };
    const answer = new Response(JSON.stringify(PHONE_VALIDATE_REPLY), { status: 200, headers });
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(answer);
    const descriptor = makeDescriptor(CompanyTypes.PayBox);
    const option = resolveApiMediator(descriptor);
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

describe('resolveTransportKind — Pepper and PayBox', () => {
  it.each([CompanyTypes.Pepper, CompanyTypes.PayBox])('selects native for %s', companyId => {
    const kind = resolveTransportKind(companyId);
    expect(kind).toBe('native');
  });
});
