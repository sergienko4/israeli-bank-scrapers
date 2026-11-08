/**
 * Leumi bootstrap follows fresh, checked website routing before identity.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { validateApiDirectConfig } from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import { createHeadlessApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
  IStepConfig,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import { runSmsOtpFlow } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/SmsOtpFlow.js';
import { registerWkUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { ITokenBus } from '../../../../../Scrapers/Pipeline/Types/Domain/TokenBus.js';
import { fakeFetch, type IFetchFake } from '../../../../Helpers/FakeFetch.js';

const HINT = CompanyTypes.Leumi;
const ORIGIN = 'https://hb2.bankleumi.co.il';
const GATE = '/staticcontent/gate-keeper/';
const SDK = `${ORIGIN}${GATE}js/transmit/8.1/xmsdk.js`;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0';
const TAGS = ['auth.prime', 'auth.landing', 'auth.service', 'auth.logout'] as const;
type BootstrapPaths = Readonly<Record<(typeof TAGS)[number], string>>;
const IDENTITY: IGetStep = {
  name: 'login',
  urlTag: 'auth.login',
  method: 'GET',
  extractsToCarry: {},
};
let steps: readonly IStepConfig[];
let paths: BootstrapPaths;
let config: IApiDirectCallConfig;

/**
 * Creates a real native mediator with a run-local cookie session.
 * @returns Native token bus.
 */
function busOf(): ITokenBus {
  return createHeadlessApiMediator({
    bankHint: HINT,
    identityBaseUrl: ORIGIN,
    graphqlUrl: `${ORIGIN}/`,
    sessionCookies: true,
    cookieDomains: ['bankleumi.co.il'],
    redirectPolicy: 'reject',
    strictUtf8: true,
  });
}

/**
 * Answers a fresh public entry and a gatekeeper page without network I/O.
 * @param query - Synthetic routing query.
 * @returns Recording fetch fake.
 */
function serveEntry(query: string): IFetchFake {
  const fake = fakeFetch((url): Response => {
    if (url.endsWith('/H/Login.html')) {
      return new Response(null, {
        status: 302,
        headers: { location: `${ORIGIN}${GATE}?${query}` },
      });
    }
    if (url.startsWith(SDK)) return new Response('synthetic SDK bytes');
    return new Response(`<script src="${SDK}"></script>`, {
      headers: { 'content-type': 'text/html' },
    });
  });
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

describe('Leumi fresh bootstrap', () => {
  const originalFetch = globalThis.fetch;
  beforeAll(async () => {
    const module =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigLeumiBootstrap.js');
    steps = module.LEUMI_BOOTSTRAP_STEPS;
    paths = module.LEUMI_BOOTSTRAP_PATHS;
    config = {
      flow: 'sms-otp',
      envelope: {},
      authScheme: 'none',
      secrets: { language: 'he' },
      steps: [...steps, IDENTITY],
    };
    for (const key of TAGS) {
      registerWkUrl(key, HINT, paths[key]);
    }
    registerWkUrl('auth.login', HINT, `${ORIGIN}/synthetic-identity`);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('passes the real API-direct builder checks', () => {
    const headless = {
      identityBase: ORIGIN,
      graphql: `${ORIGIN}/`,
      paths,
      nativeFetch: true,
      sessionCookies: true,
      cookieDomains: ['bankleumi.co.il'],
      redirectPolicy: 'reject' as const,
    };
    const result = validateApiDirectConfig({ call: config, headless });
    expect(result).toEqual({ success: true, value: true });
  });

  it.each([
    ['1', 'he'],
    ['2', 'en'],
  ])('derives fresh language %s routing without losing query fields', async (language, path) => {
    const query = `trackingCode=fresh%2Broute&sysNum=23&langNum=${language}&extra=preserved`;
    const fake = serveEntry(query);
    const scope = { carry: {}, creds: {}, config, keypair: undefined };
    const result = await runStep({
      step: steps[0],
      scope,
      bus: busOf(),
      companyId: HINT,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.carry).toMatchObject({
        trackingCode: 'fresh+route',
        sysNum: '23',
        langNum: language,
        gatekeeperUrl: `${ORIGIN}${GATE}${path}/?${query}`,
      });
    }
    const headers = new Headers(fake.calls[0].init.headers);
    const cookie = headers.get('cookie');
    expect(cookie).toContain('i18next=he');
  });

  it.each([
    'trackingCode=fresh&sysNum=24&langNum=1',
    'trackingCode=fresh&sysNum=23&sysNum=23&langNum=1',
    'trackingCode=fresh&trackingCode=again&sysNum=23&langNum=1',
    'trackingCode=fresh&sysNum=23&langNum=3',
    'trackingCode=%20%20&sysNum=23&langNum=1',
    `trackingCode=${'x'.repeat(513)}&sysNum=23&langNum=1`,
  ])('rejects unsafe entry query before another step', async query => {
    const fake = serveEntry(query);
    const scope = { carry: {}, creds: {}, config, keypair: undefined };
    const result = await runStep({
      step: steps[0],
      scope,
      bus: busOf(),
      companyId: HINT,
    });
    expect(result).toMatchObject({ success: false });
    expect(fake.calls.length).toBeLessThanOrEqual(2);
  });

  it('refuses SDK digest drift before hangup or identity', async () => {
    const query = 'trackingCode=fresh&sysNum=23&langNum=1&extra=preserved';
    const fake = serveEntry(query);
    const result = await runSmsOtpFlow({
      config,
      bus: busOf(),
      creds: { username: 'synthetic-user', password: 'synthetic-password' },
      companyId: HINT,
    });
    expect(result).toMatchObject({ success: false });
    const urls = fake.calls.map(call => call.url);
    expect(urls).toEqual([
      `${ORIGIN}/H/Login.html`,
      `${ORIGIN}${GATE}?${query}`,
      `${ORIGIN}${GATE}he/?${query}`,
      SDK,
    ]);
    for (const call of fake.calls) {
      const headers = new Headers(call.init.headers);
      const language = headers.get('accept-language');
      const userAgent = headers.get('user-agent');
      expect(language).toBe('he-IL');
      expect(userAgent).toBe(USER_AGENT);
    }
  });

  it('sends the website profile on the session reset', async () => {
    const fake = serveEntry('trackingCode=fresh&sysNum=23&langNum=1');
    const result = await runStep({
      step: steps[3],
      scope: { carry: {}, creds: {}, config, keypair: undefined },
      bus: busOf(),
      companyId: HINT,
    });
    expect(result.success).toBe(true);
    const urls = fake.calls.map(call => call.url);
    expect(urls).toEqual([`${ORIGIN}/vdesk/hangup.php3`]);
    const headers = new Headers(fake.calls[0].init.headers);
    const accept = headers.get('accept');
    const language = headers.get('accept-language');
    const userAgent = headers.get('user-agent');
    expect(accept).toBe('*/*');
    expect(language).toBe('he-IL');
    expect(userAgent).toBe(USER_AGENT);
  });
});
