/**
 * The native step engine exchanges fresh keys with an offline synthetic peer.
 */

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { validateApiDirectConfig } from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import {
  createHeadlessApiMediator,
  type IApiMediator,
} from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type {
  IApiDirectCallConfig,
  IPostStep,
  ISeedCarrySource,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import {
  type IFlowResult,
  runSmsOtpFlow,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/SmsOtpFlow.js';
import { projectSessionCarry } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/SessionCarryProjection.js';
import { registerWkUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { JsonUnknownRecord } from '../../../../../Scrapers/Pipeline/Types/JsonValue.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import createScraper from '../../../../../Scrapers/Registry/Factory.js';
import { BN_CRYPTO_SESSION } from '../../../../E2eMocked/Beinleumi/BeinleumiMockData.js';
import {
  type IOpenedRequest,
  openRequest,
  sealedReply,
  serverPoint,
  sharedKeyOf,
} from '../../../../E2eMocked/Beinleumi/BeinleumiPeer.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeJwtExpiringInWithClaims } from '../../../../Helpers/Jwt.js';
import { runPublicFactory } from './LeumiFactoryHarness.js';
import {
  answerBootstrap,
  answerPortal,
  answerWcf,
  type IWcfRequest,
  scrapeWcf,
  type WcfStage,
} from './LeumiSyntheticWcf.js';

const MODULE =
  '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigLeumiTransmit.js';
const PORTAL_MODULE =
  '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigLeumiPortal.js';
const CONFIG_MODULE = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigLeumi.js';
const ORIGIN = 'https://hb2.bankleumi.co.il';
const SERVICE = 'https://sa.bankleumi.co.il/api/v2/auth';
const HINT = CompanyTypes.Leumi;
const CREDS = { username: 'SyntheticUser', password: 'synthetic-password' };
const ROUTING = { trackingCode: 'fresh-route', sysNum: '23', langNum: '1' };
const GATE = `${ORIGIN}/staticcontent/gate-keeper/he/?trackingCode=fresh-route&sysNum=23&langNum=1`;
const SPA_SESSION = 'ABCDEF0123456789ABCDEF0123456789';
const METHOD = {
  type: 'password',
  locked: false,
  expired: false,
  assertion_id: 'synthetic-assertion',
};
const SESSION_HEADERS = [
  { type: 'session_id', session_id: 'synthetic-session' },
  { type: 'device_id', device_id: 'synthetic-device' },
];

interface ITransmitModule {
  readonly LEUMI_TRANSMIT_SEEDS: readonly ISeedCarrySource[];
  readonly LEUMI_TRANSMIT_STEPS: readonly IPostStep[];
  readonly LEUMI_TRANSMIT_PATHS: {
    readonly 'auth.encryptionKey': string;
    readonly 'auth.login': string;
    readonly 'auth.assert': string;
  };
}

interface IPortalModule {
  readonly LEUMI_PORTAL_PATHS: {
    readonly 'auth.identify': string;
    readonly 'auth.logon': string;
    readonly 'identity.sessionToken': string;
  };
}

interface ILeumiModule {
  readonly LEUMI_API_DIRECT_CALL: IApiDirectCallConfig;
  readonly LEUMI_HEADLESS: Exclude<
    Parameters<typeof validateApiDirectConfig>[0]['transport'],
    false
  >;
}

interface IPeerOptions {
  readonly mismatchEcho?: boolean;
  readonly token?: string;
  readonly failWcfAt?: WcfStage;
  readonly corruptSdk?: boolean;
}

interface IEncryptedReply {
  readonly status: number;
  readonly method: JsonUnknownRecord;
  readonly options: IPeerOptions;
}

interface IPublicRequest {
  readonly url: URL;
  readonly init: RequestInit;
  readonly wcf: IWcfRequest[];
  readonly options: IPeerOptions;
}

interface IPeer {
  readonly urls: string[];
  readonly headers: Headers[];
  readonly opened: IOpenedRequest[];
  readonly exchanges: JsonUnknownRecord[];
  readonly wcf: IWcfRequest[];
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
}

/**
 * Mints a synthetic token bound to the website policy and supplied user.
 * @param uid - Synthetic token identity.
 * @returns Synthetic compact JWT.
 */
function issuedToken(uid = CREDS.username): string {
  const claims = {
    IdBlockObject: { LeumiAuth: { Uid: uid, Site: '01' } },
    params: ROUTING,
  };
  return makeJwtExpiringInWithClaims(3600, claims);
}

/**
 * Answer an opened identity or password assertion.
 * @param path - Synthetic route.
 * @param key - Negotiated synthetic key.
 * @param reply - Synthetic challenge and completion settings.
 * @returns Encrypted synthetic response.
 */
function answerEncrypted(path: string, key: Buffer, reply: IEncryptedReply): Response {
  if (path.endsWith('/login')) {
    const data = {
      state: 'pending',
      challenge: 'synthetic-challenge',
      control_flow: [{ type: 'authentication', methods: [reply.method] }],
    };
    return sealedReply(key, data, SESSION_HEADERS);
  }
  if (!path.endsWith('/assert')) throw new TypeError('unexpected synthetic route');
  const data = {
    state: 'completed',
    assertions_complete: true,
    token: reply.options.token ?? issuedToken(),
    data: { json_data: { ts_status: reply.status } },
  };
  return sealedReply(key, data);
}

/**
 * Answers pre-authentication, portal, and financial routes when applicable.
 * @param request - Synthetic request and peer state.
 * @returns Response or false for an encrypted identity route.
 */
function answerPublic(request: IPublicRequest): Response | false {
  const { url, init, wcf, options } = request;
  const bootstrap = answerBootstrap(url, options.corruptSdk);
  if (bootstrap !== false) return bootstrap;
  const portal = answerPortal(url.pathname);
  if (portal !== false) return portal;
  if (url.pathname === '/ChannelWCF/Broker.svc/ProcessRequest')
    return answerWcf(init, wcf, options.failWcfAt);
  return false;
}

/**
 * Negotiates a synthetic key and returns the peer's exchange response.
 * @param body - Synthetic key-exchange request.
 * @param mismatchEcho - Whether the peer should send the wrong echo.
 * @returns Negotiated key and encrypted response.
 */
function answerExchange(
  body: JsonUnknownRecord,
  mismatchEcho: boolean,
): { key: Buffer; response: Response } {
  const requestHeaders = body.headers as JsonUnknownRecord[];
  const point = String(requestHeaders[1].y);
  const key = sharedKeyOf(point);
  if (key === false) throw new TypeError('invalid synthetic client point');
  const exchange = {
    type: 'key_exchange',
    scheme: 2,
    y: serverPoint(),
    echo_y: mismatchEcho ? serverPoint() : point,
    crypto_session_id: BN_CRYPTO_SESSION,
  };
  return { key, response: sealedReply(key, { r: 'Hello Encrypted World' }, [exchange]) };
}

/**
 * Creates a synthetic Transmit peer without any external I/O.
 * @param status - Website status after password assertion.
 * @param method - Offered authentication method.
 * @param options - Key-exchange and token overrides.
 * @returns The peer and its requests.
 */
function makePeer(
  status: number,
  method: JsonUnknownRecord = METHOD,
  options: IPeerOptions = {},
): IPeer {
  const urls: string[] = [];
  const headers: Headers[] = [];
  const opened: IOpenedRequest[] = [];
  const exchanges: JsonUnknownRecord[] = [];
  const wcf: IWcfRequest[] = [];
  let key: Buffer | false = false;
  /**
   * Answers one synthetic request.
   * @param url - Requested URL.
   * @param init - Request options.
   * @returns Synthetic response.
   */
  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    urls.push(url);
    headers.push(new Headers(init.headers));
    const parsed = new URL(url);
    const path = parsed.pathname;
    const publicResponse = answerPublic({ url: parsed, init, wcf, options });
    if (publicResponse !== false) return Promise.resolve(publicResponse);
    if (typeof init.body !== 'string') throw new TypeError('synthetic request body missing');
    const body = JSON.parse(init.body) as JsonUnknownRecord;
    if (path.endsWith('/key_exchange')) {
      exchanges.push(body);
      const exchange = answerExchange(body, options.mismatchEcho === true);
      key = exchange.key;
      return Promise.resolve(exchange.response);
    }
    if (key === false) throw new TypeError('synthetic session missing');
    const request = openRequest(key, body);
    if (request === false) throw new TypeError('synthetic request invalid');
    opened.push(request);
    const response = answerEncrypted(path, key, { status, method, options });
    return Promise.resolve(response);
  };
  return { urls, headers, opened, exchanges, wcf, fetch };
}

/**
 * Runs the configured steps through the real native mediator and peer.
 * @param peer - Offline peer.
 * @param creds - Synthetic credentials and optional injected flow ID.
 * @returns Flow result.
 */
async function run(
  peer: IPeer,
  creds: typeof CREDS & { readonly flowId?: string } = CREDS,
): Promise<Procedure<IFlowResult>> {
  const module = (await import(MODULE)) as ITransmitModule;
  const paths = module.LEUMI_TRANSMIT_PATHS;
  registerWkUrl('auth.encryptionKey', HINT, paths['auth.encryptionKey']);
  registerWkUrl('auth.login', HINT, paths['auth.login']);
  registerWkUrl('auth.assert', HINT, paths['auth.assert']);
  registerWkUrl('auth.logon', HINT, `${ORIGIN}/sentinel`);
  const config: IApiDirectCallConfig = {
    flow: 'sms-otp',
    envelope: {},
    authScheme: 'none',
    seedCarryFromCreds: module.LEUMI_TRANSMIT_SEEDS,
    fingerprint: { shape: { $literal: { metadata: { app: 'synthetic' } } } },
    steps: [
      ...module.LEUMI_TRANSMIT_STEPS,
      { name: 'logon', urlTag: 'auth.logon', method: 'GET', extractsToCarry: {} },
    ],
  };
  globalThis.fetch = peer.fetch as typeof globalThis.fetch;
  const bus = createHeadlessApiMediator({
    bankHint: HINT,
    identityBaseUrl: ORIGIN,
    graphqlUrl: `${ORIGIN}/`,
    sessionCookies: true,
    cookieDomains: ['bankleumi.co.il'],
    redirectPolicy: 'reject',
    strictUtf8: true,
  });
  return runSmsOtpFlow({ config, bus, creds, companyId: HINT, initialCarry: ROUTING });
}

/**
 * Runs encrypted login through the native portal with one synthetic peer.
 * @param peer - Offline peer.
 * @returns Flow result.
 */
async function runThroughPortal(peer: IPeer): Promise<{
  result: Procedure<IFlowResult>;
  bus: IApiMediator;
}> {
  const { config, headless } = await portalSetup();
  globalThis.fetch = peer.fetch as typeof globalThis.fetch;
  const bus = createHeadlessApiMediator({
    bankHint: HINT,
    identityBaseUrl: ORIGIN,
    graphqlUrl: `${ORIGIN}/`,
    sessionCookies: true,
    cookieDomains: headless.cookieDomains,
    redirectPolicy: headless.redirectPolicy,
    statusPolicy: headless.statusPolicy,
    mediaTypes: headless.mediaTypes,
    strictUtf8: true,
    responseIntegrity: headless.responseIntegrity,
  });
  const result = await runSmsOtpFlow({
    config,
    bus,
    creds: CREDS,
    companyId: HINT,
    initialCarry: { ...ROUTING, gatekeeperUrl: GATE },
    steps: config.steps.slice(4),
  });
  return { result, bus };
}

/**
 * Validate and register the candidate's synthetic portal routes.
 * @returns Candidate config and headless policies.
 */
async function portalSetup(): Promise<{
  config: IApiDirectCallConfig;
  headless: ILeumiModule['LEUMI_HEADLESS'];
}> {
  const transmit = (await import(MODULE)) as ITransmitModule;
  const portal = (await import(PORTAL_MODULE)) as IPortalModule;
  const assembled = (await import(CONFIG_MODULE)) as ILeumiModule;
  const paths = { ...transmit.LEUMI_TRANSMIT_PATHS, ...portal.LEUMI_PORTAL_PATHS };
  for (const [tag, url] of Object.entries(paths)) {
    registerWkUrl(tag as keyof typeof paths, HINT, url);
  }
  const { LEUMI_API_DIRECT_CALL: config, LEUMI_HEADLESS: headless } = assembled;
  const valid = validateApiDirectConfig({ call: config, transport: headless });
  if (!valid.success) throw new TypeError(valid.errorMessage);
  return { config, headless };
}

describe('Leumi encrypted flow with a synthetic peer', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('refuses an invalid start date before any bank request', async () => {
    const fetch = jest.fn<
      ReturnType<typeof globalThis.fetch>,
      Parameters<typeof globalThis.fetch>
    >();
    globalThis.fetch = fetch;
    const scraper = createScraper({ companyId: HINT, startDate: new Date(Number.NaN) });
    const result = await scraper.scrape(CREDS);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'Leumi startDate must be a valid date',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('runs the complete synthetic native flow with an HTML-typed JSON handoff', async () => {
    const peer = makePeer(0);
    const { result, phases, nativePhases } = await runPublicFactory(peer.fetch, CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts?.[0]).toMatchObject({
      accountNumber: '99-12345/88',
      balance: 7,
      txns: [{ chargedAmount: -10, identifier: 'current' }],
    });
    expect(phases).toEqual(['api-direct-call', 'api-direct-scrape']);
    expect(nativePhases).toEqual(phases);
    expect(peer.wcf).toHaveLength(3);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(CREDS.password);
  });

  it('stops the public factory before identity when the synthetic SDK drifts', async () => {
    const peer = makePeer(0, METHOD, { corruptSdk: true });
    const { result } = await runPublicFactory(peer.fetch, CREDS);
    expect(result.success).toBe(false);
    expect(peer.exchanges).toHaveLength(0);
    expect(peer.wcf).toHaveLength(0);
    const didSendHangup = peer.urls.some(url => url.includes('/vdesk/hangup.php3'));
    expect(didSendHangup).toBe(false);
  });

  it('does not retry the password request after a connection timeout', async () => {
    const peer = makePeer(0);
    let assertions = 0;
    /**
     * Refuse the synthetic password assertion with a connect timeout.
     * @param url - Requested URL.
     * @param init - Request options.
     * @returns The peer response or a timeout rejection.
     */
    const fetch = (url: string, init: RequestInit): Promise<Response> => {
      if (!new URL(url).pathname.endsWith('/assert')) return peer.fetch(url, init);
      assertions += 1;
      const cause = { code: 'UND_ERR_CONNECT_TIMEOUT' };
      return Promise.reject(new TypeError('fetch failed', { cause }));
    };
    const { result } = await runPublicFactory(fetch, CREDS);
    expect(result.success).toBe(false);
    expect(assertions).toBe(1);
    expect(peer.wcf).toHaveLength(0);
  });

  it('does not repeat WCF or reauthenticate after a financial 401', async () => {
    const peer = makePeer(0);
    let wcfRequests = 0;
    /**
     * Refuse the synthetic WCF request as unauthorized.
     * @param url - Requested URL.
     * @param init - Request options.
     * @returns The peer response or a 401.
     */
    const fetch = (url: string, init: RequestInit): Promise<Response> => {
      if (!new URL(url).pathname.endsWith('/Broker.svc/ProcessRequest'))
        return peer.fetch(url, init);
      wcfRequests += 1;
      return Promise.resolve(new Response('synthetic refusal', { status: 401 }));
    };
    const { result } = await runPublicFactory(fetch, CREDS);
    expect(result.success).toBe(false);
    expect(wcfRequests).toBe(1);
    expect(peer.exchanges).toHaveLength(1);
    expect(peer.opened).toHaveLength(2);
  });

  it.each([
    '/H/Login.html',
    '/staticcontent/gate-keeper/',
    '/api/v2/auth/assert',
    '/ChannelWCF/Broker.svc/ProcessRequest',
  ])('classifies a rate limit at %s and stops without retrying', async path => {
    const peer = makePeer(0);
    let refusals = 0;
    /**
     * Return a synthetic rate limit for the selected request.
     * @param url - Requested URL.
     * @param init - Request options.
     * @returns Synthetic response.
     */
    const fetch = (url: string, init: RequestInit): Promise<Response> => {
      if (new URL(url).pathname !== path) return peer.fetch(url, init);
      refusals += 1;
      return Promise.resolve(new Response('private rate-limit body', { status: 429 }));
    };
    const { result } = await runPublicFactory(fetch, CREDS);
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.WafBlocked });
    expect(refusals).toBe(1);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private rate-limit body');
  });

  it('exchanges fresh keys and sends the source-backed password packets', async () => {
    const peer = makePeer(0);
    const result = await run(peer);
    expect(result.success).toBe(true);
    const exchangeHeaders = peer.exchanges[0].headers as JsonUnknownRecord[];
    const flowId = exchangeHeaders[0].flow_id;
    expect(flowId).toMatch(/^[A-F0-9]{64}$/);
    expect(peer.opened[0].headers).toEqual([
      { type: 'flow_id', flow_id: flowId },
      { type: 'uid', uid: CREDS.username },
    ]);
    expect(peer.opened[0].data).toEqual({
      policy_request_id: 'authenticate',
      params: { ...ROUTING, customerAccountId: '', purpose: '' },
      collection_result: { metadata: { app: 'synthetic' } },
    });

    expect(peer.opened[1].data).toEqual({
      action: 'authentication',
      assert: 'authenticate',
      assertion_id: 'synthetic-assertion',
      fch: 'synthetic-challenge',
      data: { password: CREDS.password },
      method: 'password',
    });
    expect(peer.urls).toEqual([
      `${SERVICE}/key_exchange?aid=webapp&locale=he-IL`,
      `${SERVICE}/login?aid=webapp&locale=he-IL`,
      `${SERVICE}/assert?aid=webapp&did=synthetic-device&sid=synthetic-session&locale=he-IL`,
      `${ORIGIN}/sentinel`,
    ]);
  });

  it('refuses a completed password token for another user before the next request', async () => {
    const peer = makePeer(0, METHOD, { token: issuedToken('OtherUser') });
    const result = await run(peer);
    expect(result.success).toBe(false);
    const hasSentinel = peer.urls.some(url => url.endsWith('/sentinel'));
    const lastUrl = new URL(peer.urls[peer.urls.length - 1]);
    expect(hasSentinel).toBe(false);
    expect(lastUrl.pathname).toBe('/api/v2/auth/assert');
  });

  it('carries encrypted login through SSO to the genuine SPA session', async () => {
    const peer = makePeer(0);
    const { result } = await runThroughPortal(peer);
    assertOk(result);
    const session = projectSessionCarry(result.value.carrySnapshot, ['sessionToken']);
    expect(session).toEqual({ sessionToken: SPA_SESSION });
    const paths = peer.urls.map(url => new URL(url).pathname);
    expect(paths).toEqual([
      '/api/v2/auth/key_exchange',
      '/api/v2/auth/login',
      '/api/v2/auth/assert',
      '/authenticate',
      '/Ebanking/SSOLogin.aspx',
      '/eBanking/SO/SPA.aspx',
    ]);
  });

  it('uses the projected session for a guarded native WCF scrape', async () => {
    const peer = makePeer(0);
    const { result, bus } = await runThroughPortal(peer);
    assertOk(result);
    const session = projectSessionCarry(result.value.carrySnapshot, ['sessionToken']);
    bus.setSessionContext(session);
    const action = await scrapeWcf(bus);
    assertOk(action);
    assertHas(action.value.scrape);
    const [account] = action.value.scrape.value.accounts;
    expect(account).toMatchObject({
      accountNumber: '99-12345/88',
      balance: 7,
      txns: [{ chargedAmount: -10, identifier: 'current' }],
    });
    expect(peer.wcf).toHaveLength(3);
    for (const request of peer.wcf) {
      expect(request.inner.SessionHeader).toEqual({ SessionID: SPA_SESSION, FIID: 'Leumi' });
    }
    const requestTypes = peer.wcf.map(request => request.inner.RequestType);
    expect(requestTypes).toEqual([undefined, '', 'OpersB']);
  });

  it.each(['customer', 'balance'] as const)(
    'does not make later financial requests or expose a bad %s response',
    async failWcfAt => {
      const peer = makePeer(0, METHOD, { failWcfAt });
      const { result, bus } = await runThroughPortal(peer);
      assertOk(result);
      const session = projectSessionCarry(result.value.carrySnapshot, ['sessionToken']);
      bus.setSessionContext(session);
      const action = await scrapeWcf(bus);
      expect(action.success).toBe(false);
      const output = JSON.stringify(action);
      expect(output).not.toContain('synthetic-private-marker');
      expect(peer.wcf).toHaveLength(failWcfAt === 'customer' ? 1 : 2);
    },
  );

  it('stops before password submission when the offered method is OTP', async () => {
    const peer = makePeer(0, { ...METHOD, type: 'otp' });
    const result = await run(peer);
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Generic });
    expect(peer.urls).toHaveLength(2);
  });

  it('uses a fresh 64-hex flow ID on separate cold flows', async () => {
    const first = makePeer(0);
    const second = makePeer(0);
    const firstResult = await run(first);
    const secondResult = await run(second);
    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(true);
    const firstHeaders = first.exchanges[0].headers as JsonUnknownRecord[];
    const secondHeaders = second.exchanges[0].headers as JsonUnknownRecord[];
    expect(firstHeaders[0].flow_id).toMatch(/^[A-F0-9]{64}$/);
    expect(secondHeaders[0].flow_id).toMatch(/^[A-F0-9]{64}$/);
    expect(firstHeaders[0].flow_id).not.toBe(secondHeaders[0].flow_id);
  });

  it('does not send a flow ID supplied in the credentials', async () => {
    const peer = makePeer(0);
    const supplied = 'F'.repeat(64);
    const result = await run(peer, { ...CREDS, flowId: supplied });
    expect(result.success).toBe(true);
    const headers = peer.exchanges[0].headers as JsonUnknownRecord[];
    expect(headers[0].flow_id).toMatch(/^[A-F0-9]{64}$/);
    expect(headers[0].flow_id).not.toBe(supplied);
  });

  it('stops before identity submission when the exchange echo does not match', async () => {
    const peer = makePeer(0, METHOD, { mismatchEcho: true });
    const result = await run(peer);
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Generic });
    expect(peer.urls).toEqual([`${SERVICE}/key_exchange?aid=webapp&locale=he-IL`]);
    expect(peer.opened).toHaveLength(0);
  });

  it('stops before the portal on the password reminder', async () => {
    const peer = makePeer(5);
    const result = await run(peer);
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.ChangePassword });
    expect(peer.urls).toHaveLength(3);
  });
});
