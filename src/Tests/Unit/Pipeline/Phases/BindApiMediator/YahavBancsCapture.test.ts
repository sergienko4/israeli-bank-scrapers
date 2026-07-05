/**
 * BIND-API-MEDIATOR BaNCS prime unit tests — proves `primeBancsSession` pulls
 * the auth `SecToken` block + the portfolio `iorId`/`Id` out of a login-boot
 * `/BaNCSDigitalApp/account` POST in the capture pool, stashes them on the
 * mediator session-context for opted-in banks, and no-ops for non-matching
 * captures / non-POST / missing SecToken / archetype (unfilled) Prtflio /
 * opted-out banks. All ids + signatures are FAKE — never copy trace values.
 */

import { jest } from '@jest/globals';

import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.types.js';
import type { INetworkDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Network/Types/Discovery.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/Types/Endpoint.js';
import { primeBancsSession } from '../../../../../Scrapers/Pipeline/Phases/BindApiMediator/BindApiMediatorBancs.js';
import { scanCsrf } from '../../../../../Scrapers/Pipeline/Phases/BindApiMediator/BindApiMediatorBancsCsrf.js';
import { scanSpaHeaders } from '../../../../../Scrapers/Pipeline/Phases/BindApiMediator/BindApiMediatorBancsHeaders.js';
import { isSome } from '../../../../../Scrapers/Pipeline/Types/Option.js';

/** Local mirror of the registry bank-config shape (import is DI-restricted). */
interface ITestBankConfig {
  readonly urls: { readonly base: string };
  readonly balanceKind: 'account' | 'card-cycle';
  readonly authStrategyKind: 'token' | 'session-cookie' | 'api-direct';
  readonly bancsSessionCapture?: boolean;
}

const ACCOUNT_URL = 'https://digital.yahav.co.il/BaNCSDigitalApp/account';
const FAKE_SIG = 'fake-signature-0000';
const SEC_TOKEN = {
  Ver: 'SecurityToken_1.0.0',
  Token: [{ TokenId: 'fake-uuid', Signature: FAKE_SIG }],
};

/**
 * Build a captured endpoint literal for the fake pool.
 * @param url - Request URL.
 * @param method - HTTP method.
 * @param postData - Serialized request body.
 * @returns Discovered-endpoint-shaped fixture (empty request headers).
 */
function makeEndpoint(url: string, method: string, postData: string): IDiscoveredEndpoint {
  return { url, method, postData, requestHeaders: {} } as unknown as IDiscoveredEndpoint;
}

/**
 * Attach request headers to a captured endpoint (for the CSRF sniff).
 * @param ep - Base endpoint.
 * @param requestHeaders - Captured request headers.
 * @returns Endpoint carrying the headers.
 */
function withHeaders(
  ep: IDiscoveredEndpoint,
  requestHeaders: Record<string, string>,
): IDiscoveredEndpoint {
  return { ...ep, requestHeaders };
}

/**
 * Serialize an accounts request postData carrying a filled SecToken + Prtflio
 * plus a client-build `AppVer` (captured to track BaNCS deployment bumps).
 * @returns Stringified `{ SecToken, Payload, AppVer }` body.
 */
function accountBody(): string {
  const prtId = { iorId: 'fakePior', Id: 'fakeport0001' };
  const payload = { DataEntity: [{ Prtflio: { Id: prtId } }] };
  return JSON.stringify({ SecToken: SEC_TOKEN, Payload: payload, AppVer: 'fake.build.FP46' });
}

/**
 * Serialize a portfolio archetype postData whose Prtflio.Id is unfilled.
 * @returns Stringified body with an empty (archetype) portfolio id.
 */
function archetypeBody(): string {
  const payload = { DataEntity: [{ Prtflio: { Id: { isArchetype: true } } }] };
  return JSON.stringify({ SecToken: SEC_TOKEN, Payload: payload });
}

/**
 * Build a network-discovery stub returning a canned capture pool.
 * @param pool - Captures to expose.
 * @returns Network discovery whose `getAllEndpoints` yields the pool.
 */
function makeNetwork(pool: readonly IDiscoveredEndpoint[]): INetworkDiscovery {
  return {
    getAllEndpoints: jest.fn((): readonly IDiscoveredEndpoint[] => pool),
  } as unknown as INetworkDiscovery;
}

/**
 * Build a mediator spy exposing `getSessionContext` + `setSessionContext`.
 * @param existing - Pre-existing session-context bundle.
 * @returns Mediator with jest-mocked session-context accessors.
 */
function makeMediator(existing: Readonly<Record<string, unknown>>): IApiMediator {
  return {
    getSessionContext: jest.fn((): Readonly<Record<string, unknown>> => existing),
    setSessionContext: jest.fn((): boolean => true),
  } as unknown as IApiMediator;
}

/**
 * Read the first `setSessionContext` argument the mediator recorded.
 * @param mediator - Mediator spy.
 * @returns The merged session-context passed to `setSessionContext`.
 */
function firstSetArg(mediator: IApiMediator): Record<string, unknown> {
  const fn = mediator.setSessionContext as unknown as { mock: { calls: unknown[][] } };
  return fn.mock.calls[0][0] as Record<string, unknown>;
}

/**
 * Build a minimal bank config, optionally enabling the BaNCS capture.
 * @param bancsSessionCapture - Enable flag, or undefined to opt out.
 * @returns Registry-shaped config literal.
 */
function makeConfig(bancsSessionCapture?: boolean): ITestBankConfig {
  return {
    urls: { base: 'https://www.yahav.co.il' },
    balanceKind: 'account',
    authStrategyKind: 'session-cookie',
    bancsSessionCapture,
  };
}

/**
 * Run the BaNCS prime over a one-endpoint pool.
 * @param endpoint - The single pooled capture.
 * @param enabled - `bancsSessionCapture` flag.
 * @param existing - Pre-existing mediator session-context.
 * @returns The Option result + the spied mediator.
 */
function runPrime(
  endpoint: IDiscoveredEndpoint,
  enabled: boolean,
  existing: Record<string, unknown>,
): { result: ReturnType<typeof primeBancsSession>; mediator: IApiMediator } {
  const network = makeNetwork([endpoint]);
  const config = makeConfig(enabled);
  const mediator = makeMediator(existing);
  const result = primeBancsSession(config, network, mediator);
  return { result, mediator };
}

describe('BIND-API-MEDIATOR BaNCS prime — primeBancsSession', () => {
  it('CAPTURE-1 stashes the SecToken + portfolio refs from an accounts POST', () => {
    const body = accountBody();
    const endpoint = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const run = runPrime(endpoint, true, {});
    const isPresent = isSome(run.result);
    expect(isPresent).toBe(true);
    const passed = firstSetArg(run.mediator);
    expect(passed.bancsPortfolioIorId).toBe('fakePior');
    expect(passed.bancsPortfolioId).toBe('fakeport0001');
    expect(passed.bancsSecToken).toContain(FAKE_SIG);
    expect(passed.bancsAppVer).toBe('fake.build.FP46');
  });

  it('CAPTURE-2 merges into the existing session-context', () => {
    const body = accountBody();
    const endpoint = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const run = runPrime(endpoint, true, { keep: 'me' });
    const passed = firstSetArg(run.mediator);
    expect(passed.keep).toBe('me');
  });

  it('CAPTURE-3 no-ops (none) when the bank opts out', () => {
    const body = accountBody();
    const endpoint = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const run = runPrime(endpoint, false, {});
    const isPresent = isSome(run.result);
    expect(isPresent).toBe(false);
    expect(run.mediator.setSessionContext).not.toHaveBeenCalled();
  });

  it('CAPTURE-4 ignores a non-account POST', () => {
    const other = 'https://digital.yahav.co.il/BaNCSDigitalApp/portfolio';
    const body = accountBody();
    const endpoint = makeEndpoint(other, 'POST', body);
    const run = runPrime(endpoint, true, {});
    const isPresent = isSome(run.result);
    expect(isPresent).toBe(false);
  });

  it('CAPTURE-5 ignores a non-POST capture', () => {
    const body = accountBody();
    const endpoint = makeEndpoint(ACCOUNT_URL, 'GET', body);
    const run = runPrime(endpoint, true, {});
    const isPresent = isSome(run.result);
    expect(isPresent).toBe(false);
  });

  it('CAPTURE-6 skips an archetype (unfilled) portfolio request', () => {
    const body = archetypeBody();
    const endpoint = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const run = runPrime(endpoint, true, {});
    const isPresent = isSome(run.result);
    expect(isPresent).toBe(false);
  });

  it('CAPTURE-7 skips a request carrying no SecToken', () => {
    const prtId = { iorId: 'fakePior', Id: 'fakeport0001' };
    const body = JSON.stringify({ Payload: { DataEntity: [{ Prtflio: { Id: prtId } }] } });
    const endpoint = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const run = runPrime(endpoint, true, {});
    const isPresent = isSome(run.result);
    expect(isPresent).toBe(false);
  });

  it('CAPTURE-8 tolerates a malformed postData', () => {
    const endpoint = makeEndpoint(ACCOUNT_URL, 'POST', 'not-json{');
    const run = runPrime(endpoint, true, {});
    const isPresent = isSome(run.result);
    expect(isPresent).toBe(false);
  });

  it('CAPTURE-9 skips a SecToken missing its TokenId', () => {
    const badSec = { Ver: 'SecurityToken_1.0.0', Token: [{ Signature: 'x' }] };
    const prtId = { iorId: 'fakePior', Id: 'fakeport0001' };
    const payload = { DataEntity: [{ Prtflio: { Id: prtId } }] };
    const body = JSON.stringify({ SecToken: badSec, Payload: payload });
    const endpoint = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const run = runPrime(endpoint, true, {});
    const isPresent = isSome(run.result);
    expect(isPresent).toBe(false);
  });

  it('CAPTURE-10 skips an empty-string portfolio iorId', () => {
    const prtId = { iorId: '', Id: 'fakeport0001' };
    const payload = { DataEntity: [{ Prtflio: { Id: prtId } }] };
    const body = JSON.stringify({ SecToken: SEC_TOKEN, Payload: payload });
    const endpoint = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const run = runPrime(endpoint, true, {});
    const isPresent = isSome(run.result);
    expect(isPresent).toBe(false);
  });

  it('CAPTURE-11 skips an empty-string portfolio Id', () => {
    const prtId = { iorId: 'fakePior', Id: '' };
    const payload = { DataEntity: [{ Prtflio: { Id: prtId } }] };
    const body = JSON.stringify({ SecToken: SEC_TOKEN, Payload: payload });
    const endpoint = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const run = runPrime(endpoint, true, {});
    const isPresent = isSome(run.result);
    expect(isPresent).toBe(false);
  });

  it('CAPTURE-12 skips a SecToken with an empty TokenId', () => {
    const badSec = { Ver: 'SecurityToken_1.0.0', Token: [{ TokenId: '', Signature: 'x' }] };
    const prtId = { iorId: 'fakePior', Id: 'fakeport0001' };
    const payload = { DataEntity: [{ Prtflio: { Id: prtId } }] };
    const body = JSON.stringify({ SecToken: badSec, Payload: payload });
    const endpoint = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const run = runPrime(endpoint, true, {});
    const isPresent = isSome(run.result);
    expect(isPresent).toBe(false);
  });

  it('CAPTURE-13 sniffs the CSRF request header from the pool', () => {
    const body = accountBody();
    const headers = { 'content-type': 'application/json', csrftkn: 'csrf-abc' };
    const base = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const endpoint = withHeaders(base, headers);
    const run = runPrime(endpoint, true, {});
    const passed = firstSetArg(run.mediator);
    expect(passed.bancsCsrfName).toBe('csrftkn');
    expect(passed.bancsCsrfValue).toBe('csrf-abc');
  });

  it('CAPTURE-14 leaves the CSRF header empty when none is present', () => {
    const body = accountBody();
    const endpoint = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const run = runPrime(endpoint, true, {});
    const passed = firstSetArg(run.mediator);
    expect(passed.bancsCsrfName).toBe('');
  });

  it('CAPTURE-15 captures an empty AppVer when the postData omits it', () => {
    const prtId = { iorId: 'fakePior', Id: 'fakeport0001' };
    const payload = { DataEntity: [{ Prtflio: { Id: prtId } }] };
    const body = JSON.stringify({ SecToken: SEC_TOKEN, Payload: payload });
    const endpoint = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const run = runPrime(endpoint, true, {});
    const passed = firstSetArg(run.mediator);
    expect(passed.bancsAppVer).toBe('');
  });

  it('CAPTURE-16 stashes the filtered SPA header bag from the accounts POST', () => {
    const headers = {
      'x-requested-with': 'XMLHttpRequest',
      cookie: 'secret',
      accept: 'application/json',
    };
    const body = accountBody();
    const base = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const endpoint = withHeaders(base, headers);
    const run = runPrime(endpoint, true, {});
    const passed = firstSetArg(run.mediator);
    const raw = String(passed.bancsSpaHeaders);
    const bag = JSON.parse(raw) as Record<string, string>;
    expect(bag['x-requested-with']).toBe('XMLHttpRequest');
    expect(bag.accept).toBe('application/json');
    expect(bag.cookie).toBeUndefined();
  });

  it('CAPTURE-17 tolerates a valid-but-non-object JSON postData', () => {
    const endpoint = makeEndpoint(ACCOUNT_URL, 'POST', '[1,2,3]');
    const run = runPrime(endpoint, true, {});
    const isPresent = isSome(run.result);
    expect(isPresent).toBe(false);
  });
});

const LOGIN_URL = 'https://digital.yahav.co.il/BaNCSDigitalApp/login';

/**
 * Build a login endpoint carrying `csrfTkn` in its response body.
 * @param csrfTkn - CSRF token value to embed.
 * @returns Login endpoint fixture.
 */
function loginEndpoint(csrfTkn: string): IDiscoveredEndpoint {
  const responseBody = { csrfTkn };
  return {
    url: LOGIN_URL,
    method: 'POST',
    responseBody,
    requestHeaders: {},
  } as unknown as IDiscoveredEndpoint;
}

describe('BIND-API-MEDIATOR BaNCS CSRF sniff — scanCsrf', () => {
  it('CSRF-1 value-matches the request header by the login csrfTkn', () => {
    const login = loginEndpoint('tok-xyz');
    const body = accountBody();
    const base = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const acct = withHeaders(base, { 'x-opaque-name': 'tok-xyz' });
    const csrf = scanCsrf([login, acct]);
    expect(csrf.bancsCsrfName).toBe('x-opaque-name');
    expect(csrf.bancsCsrfValue).toBe('tok-xyz');
  });

  it('CSRF-2 keeps the login value with an empty name when no header matches', () => {
    const login = loginEndpoint('tok-only');
    const body = accountBody();
    const acct = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const csrf = scanCsrf([login, acct]);
    expect(csrf.bancsCsrfName).toBe('');
    expect(csrf.bancsCsrfValue).toBe('tok-only');
  });

  it('CSRF-3 yields empty when neither a login token nor a csrf header exists', () => {
    const body = accountBody();
    const acct = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const csrf = scanCsrf([acct]);
    expect(csrf.bancsCsrfValue).toBe('');
  });

  it('CSRF-4 treats a non-record login response body as no token', () => {
    const login = {
      url: LOGIN_URL,
      method: 'POST',
      responseBody: 'nope',
      requestHeaders: {},
    } as unknown as IDiscoveredEndpoint;
    const body = accountBody();
    const acct = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const csrf = scanCsrf([login, acct]);
    expect(csrf.bancsCsrfValue).toBe('');
  });

  it('CSRF-5 treats a non-string csrfTkn as no token', () => {
    const login = {
      url: LOGIN_URL,
      method: 'POST',
      responseBody: { csrfTkn: 123 },
      requestHeaders: {},
    } as unknown as IDiscoveredEndpoint;
    const body = accountBody();
    const acct = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const csrf = scanCsrf([login, acct]);
    expect(csrf.bancsCsrfValue).toBe('');
  });

  it('CSRF-6 skips a non-BaNCS request and an empty-valued csrf header', () => {
    const login = loginEndpoint('tok');
    const nonBancsBase = {
      url: 'https://x.example/api',
      method: 'POST',
      requestHeaders: {},
    } as unknown as IDiscoveredEndpoint;
    const nonBancs = withHeaders(nonBancsBase, { csrftkn: 'tok' });
    const body = accountBody();
    const emptyBase = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const emptyVal = withHeaders(emptyBase, { csrftkn: '' });
    const csrf = scanCsrf([login, nonBancs, emptyVal]);
    expect(csrf.bancsCsrfName).toBe('');
    expect(csrf.bancsCsrfValue).toBe('tok');
  });

  it('CSRF-7 prefers a later value-match over an earlier wrong-valued csrf header', () => {
    const login = loginEndpoint('real-tok');
    const decoyBody = accountBody();
    const decoyBase = makeEndpoint(ACCOUNT_URL, 'POST', decoyBody);
    const decoy = withHeaders(decoyBase, { 'x-csrf-token': 'wrong-value' });
    const realBody = accountBody();
    const realBase = makeEndpoint(ACCOUNT_URL, 'POST', realBody);
    const real = withHeaders(realBase, { 'x-opaque': 'real-tok' });
    const csrf = scanCsrf([login, decoy, real]);
    expect(csrf.bancsCsrfName).toBe('x-opaque');
    expect(csrf.bancsCsrfValue).toBe('real-tok');
  });
});

describe('BIND-API-MEDIATOR BaNCS SPA-header sniff — scanSpaHeaders', () => {
  it('SPA-1 keeps custom SPA headers and drops browser-standard + content-type', () => {
    const headers = {
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json',
      cookie: 'secret',
      origin: 'https://digital.yahav.co.il',
      'content-type': 'application/json',
    };
    const body = accountBody();
    const base = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const acct = withHeaders(base, headers);
    const raw = scanSpaHeaders([acct]).bancsSpaHeaders;
    const bag = JSON.parse(raw) as Record<string, string>;
    expect(bag['x-requested-with']).toBe('XMLHttpRequest');
    expect(bag.accept).toBe('application/json');
    expect(bag.cookie).toBeUndefined();
    expect(bag.origin).toBeUndefined();
    expect(bag['content-type']).toBeUndefined();
  });

  it('SPA-2 yields an empty bag when no accounts request carries headers', () => {
    const body = accountBody();
    const acct = makeEndpoint(ACCOUNT_URL, 'POST', body);
    const spa = scanSpaHeaders([acct]);
    expect(spa.bancsSpaHeaders).toBe('');
  });

  it('SPA-3 ignores a non-POST and a non-account endpoint', () => {
    const body = accountBody();
    const getBase = makeEndpoint(ACCOUNT_URL, 'GET', body);
    const getEp = withHeaders(getBase, { 'x-requested-with': 'x' });
    const portfolioUrl = 'https://digital.yahav.co.il/BaNCSDigitalApp/portfolio';
    const otherBase = makeEndpoint(portfolioUrl, 'POST', body);
    const otherEp = withHeaders(otherBase, { 'x-requested-with': 'x' });
    const spa = scanSpaHeaders([getEp, otherEp]);
    expect(spa.bancsSpaHeaders).toBe('');
  });
});
