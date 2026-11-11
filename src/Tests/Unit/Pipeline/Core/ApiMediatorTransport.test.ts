/**
 * Unit tests for the transport rule in Core/ApiMediatorWiring.
 *
 * A headless bank that declares a client certificate (static or dynamic) or a
 * TLS ClientHello profile runs over node:https; a bank that opts into
 * `nativeFetch` runs over Node's own fetch; a bank that declares more than one
 * transport, or none, fails fast. The bank registry and every mediator
 * factory are replaced, so each case states only its transport flags and
 * observes which factory was chosen and what it received.
 */

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type { TlsClientProfileKind } from '../../../../Scrapers/Pipeline/Strategy/Fetch/Tls/TlsClientProfiles.js';
import type { IDynamicClientCert } from '../../../../Scrapers/Pipeline/Types/Domain/ClientCertControl.js';
import type {
  MediaTypePolicy,
  RedirectPolicy,
  StatusPolicy,
} from '../../../../Scrapers/Pipeline/Types/Domain/FetchPolicy.js';

/** Transport flags a headless config block may declare. */
interface ITransportFlags {
  readonly requiresClientCert?: boolean;
  readonly clientCert?: IDynamicClientCert;
  readonly tlsProfile?: TlsClientProfileKind;
  readonly nativeFetch?: boolean;
  readonly sessionCookies?: boolean;
  readonly cookieDomains?: readonly string[];
  readonly redirectPolicy?: RedirectPolicy;
  readonly statusPolicy?: StatusPolicy;
  readonly mediaTypes?: MediaTypePolicy;
  readonly strictUtf8?: true;
}

/** URLs every case shares; only the transport flags vary. */
const BASE_TRANSPORT = {
  identityBase: 'https://identity.bank.example/v1/',
  graphql: 'https://api.bank.example/graphql',
  paths: {},
};

/** Android profile the cases declare. */
const ANDROID_PROFILE: TlsClientProfileKind = 'android-11-okhttp';

/** A certificate the flow installs at runtime for the identity origin. */
const DYNAMIC_CERT: IDynamicClientCert = {
  mode: 'dynamic',
  origin: 'https://identity.bank.example',
};

const RESOLVE_CONFIG = jest.fn<unknown, [CompanyTypes]>();
const CREATE_NODE_TLS = jest.fn((): object => ({}));
const CREATE_NATIVE = jest.fn((): object => ({}));

jest.unstable_mockModule(
  '../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js',
  () => ({
    resolvePipelineBankConfig: RESOLVE_CONFIG,
  }),
);

jest.unstable_mockModule('../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js', () => ({
  createMtlsHeadlessApiMediator: CREATE_NODE_TLS,
  createHeadlessApiMediator: CREATE_NATIVE,
}));

const WIRING = await import('../../../../Scrapers/Pipeline/Core/ApiMediatorWiring.js');

/** Flag sets that declare more than one identity transport. */
const CONFLICTING_FLAGS: readonly (readonly [string, ITransportFlags])[] = [
  ['native fetch and a client certificate', { nativeFetch: true, requiresClientCert: true }],
  ['native fetch and a TLS profile', { nativeFetch: true, tlsProfile: ANDROID_PROFILE }],
  ['native fetch and a dynamic certificate', { nativeFetch: true, clientCert: DYNAMIC_CERT }],
];

/** Flag sets that declare no identity transport at all. */
const MISSING_FLAGS: readonly (readonly [string, ITransportFlags])[] = [
  ['no transport flag', {}],
  ['native fetch switched off', { nativeFetch: false }],
];

/**
 * Register a headless block declaring the given flags for every bank.
 * @param flags - Transport flags of the bank's headless block.
 * @returns True once the config mock is set.
 */
function mockHeadless(flags: ITransportFlags): boolean {
  RESOLVE_CONFIG.mockReturnValue({ transport: { ...BASE_TRANSPORT, ...flags } });
  return true;
}

/**
 * Resolve the headless mediator for a bank declaring the given flags.
 * @param flags - Transport flags of the bank's headless block.
 * @returns True once the resolver has run.
 */
function resolveWith(flags: ITransportFlags): boolean {
  mockHeadless(flags);
  const options = { companyId: CompanyTypes.OneZero } as unknown as ScraperOptions;
  const descriptor: IPipelineDescriptor = { options, phases: [] };
  WIRING.resolveApiMediator(descriptor);
  return true;
}

/**
 * Name the factories the resolver invoked.
 * @returns `node-tls`, `native`, several joined with `+`, or empty.
 */
function chosenTransport(): string {
  const calls = {
    'node-tls': CREATE_NODE_TLS.mock.calls.length,
    native: CREATE_NATIVE.mock.calls.length,
  };
  const chosen = Object.entries(calls).filter(([, count]): boolean => count > 0);
  return chosen.map(([name]): string => name).join('+');
}

describe('ApiMediatorWiring — transport selection', () => {
  beforeEach(() => {
    CREATE_NODE_TLS.mockClear();
    CREATE_NATIVE.mockClear();
  });

  it.each<[string, ITransportFlags, string]>([
    ['a TLS profile alone', { tlsProfile: ANDROID_PROFILE }, 'node-tls'],
    ['a client certificate alone', { requiresClientCert: true }, 'node-tls'],
    ['a dynamic client certificate', { clientCert: DYNAMIC_CERT }, 'node-tls'],
    [
      'a certificate and a profile',
      { requiresClientCert: true, tlsProfile: ANDROID_PROFILE },
      'node-tls',
    ],
    ['native fetch', { nativeFetch: true }, 'native'],
    [
      'native fetch off with a TLS profile',
      { nativeFetch: false, tlsProfile: ANDROID_PROFILE },
      'node-tls',
    ],
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

  it('hands the dynamic client certificate to the node:https factory', () => {
    resolveWith({ clientCert: DYNAMIC_CERT });
    const [args] = CREATE_NODE_TLS.mock.calls[0] as unknown[];
    expect(args).toMatchObject({ clientCert: DYNAMIC_CERT, requiresClientCert: false });
  });

  it('hands the identity base URL to the native factory', () => {
    resolveWith({ nativeFetch: true });
    const [args] = CREATE_NATIVE.mock.calls[0] as unknown[];
    expect(args).toMatchObject({ identityBaseUrl: BASE_TRANSPORT.identityBase });
  });

  it.each<[string, ITransportFlags, typeof CREATE_NATIVE]>([
    ['native', { nativeFetch: true, sessionCookies: true }, CREATE_NATIVE],
    ['node:https', { tlsProfile: ANDROID_PROFILE, sessionCookies: true }, CREATE_NODE_TLS],
  ])('hands the cookie jar flag to the %s factory', (_label, flags, factory) => {
    resolveWith(flags);
    const [args] = factory.mock.calls[0] as unknown[];
    expect(args).toMatchObject({ sessionCookies: true });
  });

  it('hands the cookie domains to the factory', () => {
    resolveWith({ nativeFetch: true, sessionCookies: true, cookieDomains: ['bank.example'] });
    const [args] = CREATE_NATIVE.mock.calls[0] as unknown[];
    expect(args).toMatchObject({ cookieDomains: ['bank.example'] });
  });

  it('hands dynamic-certificate domain cookies to the node:https factory', () => {
    resolveWith({
      clientCert: DYNAMIC_CERT,
      sessionCookies: true,
      cookieDomains: ['bank.example'],
    });
    const [args] = CREATE_NODE_TLS.mock.calls[0] as unknown[];
    expect(args).toMatchObject({
      clientCert: DYNAMIC_CERT,
      sessionCookies: true,
      cookieDomains: ['bank.example'],
    });
  });

  it('hands the redirect policy to the native factory', () => {
    resolveWith({ nativeFetch: true, redirectPolicy: 'reject' });
    const [args] = CREATE_NATIVE.mock.calls[0] as unknown[];
    expect(args).toMatchObject({ redirectPolicy: 'reject' });
  });

  it('hands the status policy to the native factory', () => {
    resolveWith({ nativeFetch: true, statusPolicy: { 204: 'empty' } });
    const [args] = CREATE_NATIVE.mock.calls[0] as unknown[];
    expect(args).toMatchObject({ statusPolicy: { 204: 'empty' } });
  });

  it('hands the media type defaults to the native factory', () => {
    resolveWith({ nativeFetch: true, mediaTypes: { json: 'application/json' } });
    const [args] = CREATE_NATIVE.mock.calls[0] as unknown[];
    expect(args).toMatchObject({ mediaTypes: { json: 'application/json' } });
  });

  it('hands strict UTF-8 decoding to the native factory', () => {
    resolveWith({ nativeFetch: true, strictUtf8: true });
    const [args] = CREATE_NATIVE.mock.calls[0] as unknown[];
    expect(args).toMatchObject({ strictUtf8: true });
  });

  it('defaults the cookie jar flag to false', () => {
    resolveWith({ nativeFetch: true });
    const [args] = CREATE_NATIVE.mock.calls[0] as unknown[];
    expect(args).toMatchObject({ sessionCookies: false });
  });

  it.each(CONFLICTING_FLAGS)('fails fast when %s are combined', (_label, flags) => {
    /**
     * Resolve the mediator for the conflicting config.
     * @returns Never; the resolver throws.
     */
    const resolveConflict = (): boolean => resolveWith(flags);
    expect(resolveConflict).toThrow(/mutually exclusive \(oneZero\)/);
    const transport = chosenTransport();
    expect(transport).toBe('');
  });

  it.each(MISSING_FLAGS)('fails closed when the block declares %s', (_label, flags) => {
    /**
     * Resolve the mediator for the transport-less config.
     * @returns Never; the resolver throws.
     */
    const resolveMissing = (): boolean => resolveWith(flags);
    expect(resolveMissing).toThrow(/Missing headless transport.*\(oneZero\)/);
    const transport = chosenTransport();
    expect(transport).toBe('');
  });
});

/** Transport kind for each factory name {@link chosenTransport} reports. */
const KIND_OF_FACTORY: Readonly<Record<string, string>> = {
  'node-tls': 'node-tls',
  native: 'native',
};

describe('resolveTransportKind — agrees with the wired factory', () => {
  beforeEach(() => {
    CREATE_NODE_TLS.mockClear();
    CREATE_NATIVE.mockClear();
  });

  it.each<[string, ITransportFlags]>([
    ['a TLS profile', { tlsProfile: ANDROID_PROFILE }],
    ['a client certificate', { requiresClientCert: true }],
    ['a dynamic client certificate', { clientCert: DYNAMIC_CERT }],
    ['native fetch', { nativeFetch: true }],
  ])('names the transport wired for %s', (_label, flags) => {
    resolveWith(flags);
    const transport = chosenTransport();
    const kind = WIRING.resolveTransportKind(CompanyTypes.OneZero);
    expect(kind).toBe(KIND_OF_FACTORY[transport]);
  });

  it.each(CONFLICTING_FLAGS)('rejects %s before returning a kind', (_label, flags) => {
    mockHeadless(flags);
    /**
     * Resolve the kind for the conflicting config.
     * @returns Never; the resolver throws.
     */
    const resolveKind = (): unknown => WIRING.resolveTransportKind(CompanyTypes.OneZero);
    expect(resolveKind).toThrow(/mutually exclusive \(oneZero\)/);
  });

  it.each(MISSING_FLAGS)('rejects %s before returning a kind', (_label, flags) => {
    mockHeadless(flags);
    /**
     * Resolve the kind for the transport-less config.
     * @returns Never; the resolver throws.
     */
    const resolveKind = (): unknown => WIRING.resolveTransportKind(CompanyTypes.OneZero);
    expect(resolveKind).toThrow(/Missing headless transport.*\(oneZero\)/);
  });

  it.each<[string, unknown]>([
    ['an unregistered bank', false],
    ['a bank with no headless block', {}],
  ])('returns false for %s', (_label, config) => {
    RESOLVE_CONFIG.mockReturnValue(config);
    const kind = WIRING.resolveTransportKind(CompanyTypes.OneZero);
    expect(kind).toBe(false);
  });
});
