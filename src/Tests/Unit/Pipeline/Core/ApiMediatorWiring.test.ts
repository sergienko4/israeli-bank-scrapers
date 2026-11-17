/**
 * Unit tests for Core/ApiMediatorWiring.resolveApiMediator — the
 * transport selector. Asserts: a bank with no transport config yields none();
 * OneZero (requiresClientCert) yields a mTLS-backed mediator; PayBox (native
 * fetch) yields a Node-fetch-backed mediator, and a PayBox phoneValidate POST
 * reaches the configured URL through a stubbed globalThis.fetch. No network is
 * performed.
 */

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import { isSome } from '../../../../Scrapers/Pipeline/Types/Option.js';

/** One bank's pipeline config, as the resolver returns it. */
interface IBankConfig {
  readonly urls: { readonly base: string };
  readonly transport?: {
    readonly identityBase: string;
    readonly graphql: string;
    readonly paths: Readonly<Record<string, string>>;
    readonly nativeFetch?: boolean;
    readonly clientCert?: { readonly mode: 'dynamic'; readonly origin: string };
    readonly redirectPolicy?: 'reject';
  };
}

const PHONE_VALIDATE_URL = 'https://apipin.payboxapp.com/api/2.0/phoneValidate';
const PHONE_VALIDATE_BODY = { phoneNum: '+972-50-0000000', isVoiceCall: false };
const PHONE_VALIDATE_REPLY = { code: 0, content: { access_token: 'synthetic-access-token' } };

/** Synthetic wiring configs: only the transport block matters here. */
const CONFIGS: Partial<Record<CompanyTypes, IBankConfig>> = {
  [CompanyTypes.Leumi]: { urls: { base: 'https://www.leumi.co.il' } },
  [CompanyTypes.OneZero]: {
    urls: { base: 'https://www.onezerobank.com' },
    transport: {
      identityBase: 'https://identity.onezero.example',
      graphql: 'https://graphql.onezero.example',
      paths: {},
      clientCert: { mode: 'dynamic', origin: 'https://identity.onezero.example' },
    },
  },
  [CompanyTypes.PayBox]: {
    urls: { base: 'https://www.payboxapp.com/' },
    transport: {
      identityBase: 'https://apipin.payboxapp.com/api/2.0/',
      graphql: 'https://apipin.payboxapp.com/api/2.0/',
      paths: { 'identity.phoneValidate': PHONE_VALIDATE_URL },
      nativeFetch: true,
      redirectPolicy: 'reject',
    },
  },
};

/**
 * Resolve from the synthetic table above; Leumi deliberately has no transport.
 * @param companyId - Bank named in the descriptor.
 * @returns Its config, or false when unregistered.
 */
function resolveMocked(companyId: CompanyTypes): IBankConfig | false {
  return CONFIGS[companyId] ?? false;
}

jest.unstable_mockModule(
  '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js',
  () => ({ resolvePipelineBankConfig: resolveMocked }),
);

const SEEDER =
  await import('../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigSeeder.js');
SEEDER.default(CONFIGS);
const API_MEDIATOR_WIRING = await import('../../../../Scrapers/Pipeline/Core/ApiMediatorWiring.js');
const RESOLVE_API_MEDIATOR = API_MEDIATOR_WIRING.resolveApiMediator;

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
  it('returns none() when a bank has no headless config block', () => {
    const descriptor = makeDescriptor(CompanyTypes.Leumi);
    const option = RESOLVE_API_MEDIATOR(descriptor);
    const isPresent = isSome(option);
    expect(isPresent).toBe(false);
  });
});

describe('resolveApiMediator — some(mediator) cases', () => {
  it('wires a mTLS mediator for OneZero (dynamic client certificate)', () => {
    const descriptor = makeDescriptor(CompanyTypes.OneZero);
    const option = RESOLVE_API_MEDIATOR(descriptor);
    const isPresent = isSome(option);
    expect(isPresent).toBe(true);
    if (isSome(option)) {
      expect(typeof option.value.apiPost).toBe('function');
      expect(typeof option.value.apiQuery).toBe('function');
    }
  });

  it('wires a Node-fetch mediator for PayBox (nativeFetch)', () => {
    const descriptor = makeDescriptor(CompanyTypes.PayBox);
    const option = RESOLVE_API_MEDIATOR(descriptor);
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
    const option = RESOLVE_API_MEDIATOR(descriptor);
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
