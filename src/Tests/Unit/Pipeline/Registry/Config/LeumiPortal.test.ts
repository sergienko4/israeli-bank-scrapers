/**
 * Leumi's portal handoff against a synthetic native HTTP peer.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { validateApiDirectConfig } from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import { createHeadlessApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type {
  IApiDirectCallConfig,
  IDerivedCarry,
  IGetStep,
  IJwtClaimsCapture,
  ISeedCarrySource,
  IStepConfig,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runSmsOtpFlow } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/SmsOtpFlow.js';
import {
  registerWkUrl,
  resetWkRegistryForTest,
} from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { StatusPolicy } from '../../../../../Scrapers/Pipeline/Types/Domain/FetchPolicy.js';
import { fakeFetch, type IFetchFake } from '../../../../Helpers/FakeFetch.js';
import { makeJwtExpiringInWithClaims } from '../../../../Helpers/Jwt.js';

const MODULE = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigLeumiPortal.js';
const ORIGIN = 'https://hb2.bankleumi.co.il';
const USER = 'Synthetic+User';
const SESSION = 'ABCDEF0123456789ABCDEF0123456789';
const GATE = `${ORIGIN}/staticcontent/gate-keeper/he/?trackingCode=fresh&sysNum=23&langNum=1&extra=keep`;
const ROUTING = { trackingCode: 'fresh', sysNum: '23', langNum: '1', gatekeeperUrl: GATE };

interface IPortalModule {
  readonly LEUMI_JWT_CAPTURE: IJwtClaimsCapture;
  readonly LEUMI_SITE_GUARD: readonly IDerivedCarry[];
  readonly LEUMI_PORTAL_SEEDS: readonly ISeedCarrySource[];
  readonly LEUMI_STATUS_POLICY: StatusPolicy;
  readonly LEUMI_PORTAL_STEPS: readonly IStepConfig[];
  readonly LEUMI_PORTAL_PATHS: {
    readonly 'auth.identify': string;
    readonly 'auth.logon': string;
    readonly 'identity.sessionToken': string;
  };
}

interface IPeerOptions {
  readonly site?: string;
  readonly uid?: string;
  readonly trackingCode?: string;
  readonly withJti?: boolean;
  readonly jti?: string;
  readonly landing?: string;
  readonly authStatus?: number;
  readonly authMediaType?: string;
  readonly ssoStatus?: number;
  readonly ssoError?: string;
  readonly sessionId?: string;
  readonly spaStatus?: number;
  readonly spaLanding?: string;
  readonly spaHtml?: string;
}

/**
 * Mints a synthetic, structurally valid but unsigned token.
 * @param options - Claim overrides.
 * @returns Synthetic token.
 */
function tokenOf(options: IPeerOptions): string {
  const site = options.site ?? '01';
  const uid = options.uid ?? USER;
  const claims = {
    IdBlockObject: { LeumiAuth: { Uid: uid, Site: site } },
    params: { trackingCode: options.trackingCode ?? 'fresh', sysNum: '23', langNum: '1' },
    ...(options.withJti === true ? { jti: options.jti ?? 'synthetic-jti' } : {}),
  };
  return makeJwtExpiringInWithClaims(3600, claims);
}

/**
 * Answer the synthetic authenticate request.
 * @param options - Peer overrides.
 * @returns Synthetic JSON response.
 */
function authAnswer(options: IPeerOptions): Response {
  const landing =
    options.landing ??
    '/eBanking/SSOLogin.aspx?SectorCheck=Override&userId=old&trackingCode=old&trackingCode=stale';
  return new Response(JSON.stringify({ LandingPage: landing }), {
    status: options.authStatus ?? 200,
    headers: { 'content-type': options.authMediaType ?? 'text/html; charset=utf-8' },
  });
}

/**
 * Answer the synthetic SSO request.
 * @param options - Peer overrides.
 * @returns Synthetic SSO response.
 */
function ssoAnswer(options: IPeerOptions): Response {
  const headers = new Headers({ LandingPage: options.spaLanding ?? '/eBanking/SO/SPA.aspx' });
  if (options.ssoError !== undefined) headers.set('SSOLoginError', options.ssoError);
  if (options.sessionId !== undefined) headers.set('sessionID', options.sessionId);
  return new Response('', { status: options.ssoStatus ?? 200, headers });
}

/**
 * Answer the synthetic SPA request.
 * @param options - Peer overrides.
 * @returns Synthetic HTML response.
 */
function spaAnswer(options: IPeerOptions): Response {
  const state = JSON.stringify({ SessionID: SESSION });
  const json = JSON.stringify(state);
  const html = options.spaHtml ?? `<script>window.ClientBootstrap = ${json};</script>`;
  return new Response(html, {
    status: options.spaStatus ?? 200,
    headers: { 'content-type': 'text/html' },
  });
}

/**
 * Provides an offline endpoint for each portal request.
 * @param options - Peer response overrides.
 * @returns Fake transport and its synthetic token.
 */
function makePortalPeer(options: IPeerOptions): { fake: IFetchFake; token: string } {
  const token = tokenOf(options);
  const routes = new Map<string, () => Response>([
    ['/synthetic-token', (): Response => Response.json({ token })],
    ['/authenticate', (): Response => authAnswer(options)],
    ['/Ebanking/SSOLogin.aspx', (): Response => ssoAnswer(options)],
    ['/eBanking/SO/SPA.aspx', (): Response => spaAnswer(options)],
  ]);
  const fake = fakeFetch((url): Response => {
    const path = new URL(url).pathname;
    const answer = routes.get(path);
    if (answer === undefined) throw new TypeError('unexpected synthetic portal route');
    return answer();
  });
  return { fake, token };
}

/**
 * Assemble the synthetic token capture and portal steps.
 * @param module - Candidate declarations.
 * @returns Flow configuration.
 */
function portalConfig(module: IPortalModule): IApiDirectCallConfig {
  const first: IGetStep = {
    name: 'validate',
    urlTag: 'auth.verify',
    method: 'GET',
    extractsToCarry: { token: '/token' },
    structuredCapture: module.LEUMI_JWT_CAPTURE,
    deriveCarry: module.LEUMI_SITE_GUARD,
  };
  return {
    flow: 'sms-otp',
    envelope: {},
    authScheme: 'none',
    sessionCarry: ['sessionToken'],
    seedCarryFromCreds: module.LEUMI_PORTAL_SEEDS,
    steps: [first, ...module.LEUMI_PORTAL_STEPS],
  };
}

/**
 * Validate and register the candidate portal routes.
 * @param module - Candidate declarations.
 * @param config - Candidate flow.
 * @returns The validated flow.
 */
function preparePortal(module: IPortalModule, config: IApiDirectCallConfig): IApiDirectCallConfig {
  const headless = {
    identityBase: ORIGIN,
    graphql: `${ORIGIN}/`,
    paths: module.LEUMI_PORTAL_PATHS,
    nativeFetch: true,
    sessionCookies: true,
    cookieDomains: ['bankleumi.co.il'],
    redirectPolicy: 'reject' as const,
    statusPolicy: module.LEUMI_STATUS_POLICY,
  };
  const validation = validateApiDirectConfig({ call: config, transport: headless });
  if (!validation.success) throw new TypeError(validation.errorMessage);
  resetWkRegistryForTest();
  registerWkUrl('auth.verify', CompanyTypes.Leumi, `${ORIGIN}/synthetic-token`);
  registerWkUrl('auth.identify', CompanyTypes.Leumi, module.LEUMI_PORTAL_PATHS['auth.identify']);
  registerWkUrl('auth.logon', CompanyTypes.Leumi, module.LEUMI_PORTAL_PATHS['auth.logon']);
  registerWkUrl(
    'identity.sessionToken',
    CompanyTypes.Leumi,
    module.LEUMI_PORTAL_PATHS['identity.sessionToken'],
  );
  return config;
}

/**
 * Runs a token capture and the candidate portal against a fake native peer.
 * @param options - Peer response overrides.
 * @returns Result, synthetic requests and token.
 */
async function runPortal(options: IPeerOptions = {}): Promise<{
  result: Awaited<ReturnType<typeof runSmsOtpFlow>>;
  fake: IFetchFake;
  token: string;
}> {
  const module = (await import(MODULE)) as IPortalModule;
  const config = portalConfig(module);
  preparePortal(module, config);
  const { fake, token } = makePortalPeer(options);
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  const bus = createHeadlessApiMediator({
    bankHint: CompanyTypes.Leumi,
    identityBaseUrl: ORIGIN,
    graphqlUrl: `${ORIGIN}/`,
    sessionCookies: true,
    cookieDomains: ['bankleumi.co.il'],
    redirectPolicy: 'reject',
    statusPolicy: module.LEUMI_STATUS_POLICY,
    strictUtf8: true,
  });
  const creds = { username: USER };
  const result = await runSmsOtpFlow({
    config,
    bus,
    creds,
    companyId: CompanyTypes.Leumi,
    initialCarry: ROUTING,
  });
  return { result, fake, token };
}

/**
 * Check synthetic authenticate bytes and headers.
 * @param fake - Recorded transport.
 * @param token - Synthetic issued token.
 * @returns True after the assertions pass.
 */
function checkAuthenticate(fake: IFetchFake, token: string): boolean {
  const auth = fake.calls[1];
  if (typeof auth.init.body !== 'string') throw new TypeError('missing synthetic form body');
  const form = new URLSearchParams(auth.init.body);
  const headers = new Headers(auth.init.headers);
  const actual = {
    contentType: headers.get('content-type'),
    referer: headers.get('referer'),
    password: form.get('password'),
    uid: form.get('uid'),
  };
  expect(actual).toEqual({
    contentType: 'text/plain;charset=UTF-8',
    referer: GATE,
    password: token,
    uid: USER,
  });
  return true;
}

/**
 * Check synthetic SSO query and headers.
 * @param fake - Recorded transport.
 * @param token - Synthetic issued token.
 * @returns True after the assertions pass.
 */
function checkSso(fake: IFetchFake, token: string): boolean {
  const sso = new URL(fake.calls[2].url);
  const query = sso.searchParams;
  const actual = {
    path: sso.pathname,
    sector: query.get('SectorCheck'),
    extra: query.get('extra'),
    userIds: query.getAll('userId'),
    tracking: query.getAll('trackingCode'),
  };
  expect(actual).toEqual({
    path: '/Ebanking/SSOLogin.aspx',
    sector: 'Override',
    extra: 'keep',
    userIds: [USER],
    tracking: ['fresh'],
  });
  const headers = new Headers(fake.calls[2].init.headers);
  const authorization = headers.get('authorization');
  const hasSession = headers.has('x-session-id');
  const hasMessage = headers.has('x-message-id');
  expect({ authorization, hasSession, hasMessage }).toEqual({
    authorization: token,
    hasSession: false,
    hasMessage: false,
  });
  return true;
}

describe('Leumi portal handoff', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('binds a site-01 token without jti and reaches the root SPA session', async () => {
    const { result, fake, token } = await runPortal();
    expect(result).toMatchObject({
      success: true,
      value: { carrySnapshot: { sessionToken: SESSION } },
    });
    expect(fake.calls).toHaveLength(4);
    checkAuthenticate(fake, token);
    checkSso(fake, token);
    const spaHeaders = new Headers(fake.calls[3].init.headers);
    const cookies = spaHeaders.get('cookie');
    expect(cookies).toContain(`transmitToken=${token}`);
    expect(cookies).not.toContain('cochavSessionId=');
  });

  it.each(['40', '70'])('sends site-%s headers with a validated jti', async site => {
    const { result, fake } = await runPortal({
      site,
      withJti: true,
      sessionId: 'synthetic-session',
    });
    expect(result.success).toBe(true);
    const headers = new Headers(fake.calls[2].init.headers);
    const sessionId = headers.get('x-session-id');
    const uid = headers.get('x-uid');
    const message = headers.get('x-message-id');
    const transaction = headers.get('x-transaction-id');
    expect(sessionId).toBe('synthetic-jti');
    expect(uid).toBe(USER);
    expect(message).toMatch(/^[a-f0-9-]{36}$/);
    expect(transaction).toMatch(/^[a-f0-9-]{36}$/);
    const spa = new Headers(fake.calls[3].init.headers);
    const cookies = spa.get('cookie');
    expect(cookies).toContain('cochavSessionId=synthetic-session');
  });

  it('stops before authenticate when the issued UID does not match', async () => {
    const { result, fake } = await runPortal({ uid: 'OtherUser' });
    expect(result.success).toBe(false);
    expect(fake.calls).toHaveLength(1);
  });

  it('stops before authenticate when the token routing does not match', async () => {
    const { result, fake } = await runPortal({ trackingCode: 'old' });
    expect(result.success).toBe(false);
    expect(fake.calls).toHaveLength(1);
  });

  it('stops before authenticate for an unsupported site', async () => {
    const { result, fake } = await runPortal({ site: '99' });
    expect(result.success).toBe(false);
    expect(fake.calls).toHaveLength(1);
  });

  it('stops before SSO when a site requiring jti has none', async () => {
    const { result, fake } = await runPortal({ site: '40' });
    expect(result.success).toBe(false);
    expect(fake.calls).toHaveLength(2);
  });

  it('stops before SSO when a required jti is whitespace-only', async () => {
    const { result, fake } = await runPortal({ site: '40', withJti: true, jti: '   ' });
    expect(result.success).toBe(false);
    expect(fake.calls).toHaveLength(2);
  });

  it('stops before SSO for a foreign authenticate landing', async () => {
    const { result, fake } = await runPortal({
      landing: 'https://foreign.example/Ebanking/SSOLogin.aspx',
    });
    expect(result.success).toBe(false);
    expect(fake.calls).toHaveLength(2);
  });

  it('refuses an unexpected authenticate media type before SSO', async () => {
    const { result, fake } = await runPortal({ authMediaType: 'text/plain' });
    expect(result.success).toBe(false);
    expect(fake.calls).toHaveLength(2);
  });

  it.each([
    [{ authStatus: 201 }, 2],
    [{ ssoStatus: 201 }, 3],
    [{ spaStatus: 201 }, 4],
  ])('refuses a non-200 success status before continuing', async (options, requests) => {
    const { result, fake } = await runPortal(options);
    expect(result.success).toBe(false);
    expect(fake.calls).toHaveLength(requests);
  });

  it.each([{ ssoStatus: 302 }, { ssoError: 'synthetic-refusal' }])(
    'stops before SPA when SSO rejects the session',
    async options => {
      const { result, fake } = await runPortal(options);
      expect(result.success).toBe(false);
      expect(fake.calls).toHaveLength(3);
    },
  );

  it('does not visit a foreign SPA landing returned by SSO', async () => {
    const { result, fake } = await runPortal({
      spaLanding: 'https://foreign.example/eBanking/SO/SPA.aspx',
    });
    expect(result.success).toBe(false);
    expect(fake.calls).toHaveLength(3);
    const output = JSON.stringify(result);
    expect(output).not.toContain('foreign.example');
  });

  it('refuses an unsafe optional portal cookie before the SPA request', async () => {
    const { result, fake } = await runPortal({ sessionId: 'invalid session' });
    expect(result.success).toBe(false);
    expect(fake.calls).toHaveLength(3);
  });

  it('does not accept a session ID nested inside serialized SPA state', async () => {
    const nested = JSON.stringify({ nested: { SessionID: SESSION } });
    const state = JSON.stringify(nested);
    const { result, fake } = await runPortal({
      spaHtml: `<script>window.state=${state};</script>`,
    });
    expect(result.success).toBe(false);
    expect(fake.calls).toHaveLength(4);
  });
});
