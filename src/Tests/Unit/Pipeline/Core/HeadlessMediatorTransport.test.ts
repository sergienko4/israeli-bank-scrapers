/**
 * Unit tests for the transport rule in Core/HeadlessMediatorWiring.
 *
 * A headless bank that declares a client certificate or a TLS ClientHello
 * profile runs over node:https; any other headless bank runs over browser
 * TLS; a bank that asks for both fails fast. The bank registry and both
 * mediator factories are replaced, so each case states only its transport
 * flags and observes which factory was chosen and what it received.
 */

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type { TlsClientProfileKind } from '../../../../Scrapers/Pipeline/Strategy/Fetch/Tls/TlsClientProfiles.js';

/** Transport flags a headless config block may declare. */
interface ITransportFlags {
  readonly requiresBrowserTls?: boolean;
  readonly requiresClientCert?: boolean;
  readonly tlsProfile?: TlsClientProfileKind;
}

/** URLs every case shares; only the transport flags vary. */
const BASE_HEADLESS = {
  identityBase: 'https://identity.bank.example/v1/',
  graphql: 'https://api.bank.example/graphql',
  paths: {},
};

/** Android profile the cases declare. */
const ANDROID_PROFILE: TlsClientProfileKind = 'android-11-okhttp';

const RESOLVE_CONFIG = jest.fn<unknown, [CompanyTypes]>();
const CREATE_NODE_TLS = jest.fn((): object => ({}));
const CREATE_BROWSER_TLS = jest.fn((): object => ({}));

jest.unstable_mockModule(
  '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js',
  () => ({
    resolvePipelineBankConfig: RESOLVE_CONFIG,
  }),
);

jest.unstable_mockModule('../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js', () => ({
  createMtlsHeadlessApiMediator: CREATE_NODE_TLS,
  createBrowserBackedHeadlessApiMediator: CREATE_BROWSER_TLS,
}));

const WIRING = await import('../../../../Scrapers/Pipeline/Core/HeadlessMediatorWiring.js');

/**
 * Resolve the headless mediator for a bank declaring the given flags.
 * @param flags - Transport flags of the bank's headless block.
 * @returns True once the resolver has run.
 */
function resolveWith(flags: ITransportFlags): boolean {
  RESOLVE_CONFIG.mockReturnValue({ headless: { ...BASE_HEADLESS, ...flags } });
  const options = { companyId: CompanyTypes.OneZero } as unknown as ScraperOptions;
  const descriptor: IPipelineDescriptor = {
    options,
    phases: [],
    interceptors: [],
    isHeadless: true,
  };
  WIRING.resolveHeadlessApiMediator(descriptor);
  return true;
}

/**
 * Name the factories the resolver invoked.
 * @returns `node-tls`, `browser-tls`, both joined with `+`, or empty.
 */
function chosenTransport(): string {
  const calls = {
    'node-tls': CREATE_NODE_TLS.mock.calls.length,
    'browser-tls': CREATE_BROWSER_TLS.mock.calls.length,
  };
  const chosen = Object.entries(calls).filter(([, count]): boolean => count > 0);
  return chosen.map(([name]): string => name).join('+');
}

describe('HeadlessMediatorWiring — transport selection', () => {
  beforeEach(() => {
    CREATE_NODE_TLS.mockClear();
    CREATE_BROWSER_TLS.mockClear();
  });

  it.each<[string, ITransportFlags, string]>([
    ['a TLS profile alone', { tlsProfile: ANDROID_PROFILE }, 'node-tls'],
    ['a client certificate alone', { requiresClientCert: true }, 'node-tls'],
    [
      'a certificate and a profile',
      { requiresClientCert: true, tlsProfile: ANDROID_PROFILE },
      'node-tls',
    ],
    ['browser TLS', { requiresBrowserTls: true }, 'browser-tls'],
    ['no transport flag', {}, 'browser-tls'],
  ])('routes %s to %s', (_label, flags, expected) => {
    resolveWith(flags);
    const transport = chosenTransport();
    expect(transport).toBe(expected);
  });

  it('hands the TLS profile and certificate flag to the node:https factory', () => {
    resolveWith({ tlsProfile: ANDROID_PROFILE });
    const [args] = CREATE_NODE_TLS.mock.calls[0] as unknown[];
    expect(args).toMatchObject({ tlsProfile: ANDROID_PROFILE, requiresClientCert: false });
  });

  it.each<[string, ITransportFlags]>([
    ['a TLS profile', { tlsProfile: ANDROID_PROFILE, requiresBrowserTls: true }],
    ['a client certificate', { requiresClientCert: true, requiresBrowserTls: true }],
  ])('fails fast when %s is combined with browser TLS', (_label, flags) => {
    /**
     * Resolve the mediator for the conflicting config.
     * @returns Never; the resolver throws.
     */
    const resolveConflict = (): boolean => resolveWith(flags);
    expect(resolveConflict).toThrow(/mutually exclusive \(oneZero\)/);
    const transport = chosenTransport();
    expect(transport).toBe('');
  });
});
