/**
 * BIND-API-MEDIATOR session-token prime unit tests — proves `extractSessionToken`
 * pulls a body-borne session id out of the login-capture pool (double-encoded WCF
 * `reqObj` and flat JSON), ignores non-matching / non-POST / malformed captures,
 * and that `primeSessionToken` stashes the token on the mediator session-context
 * for opted-in banks, merges into the existing context, and no-ops otherwise.
 * All session ids are FAKE — never copy real trace values into fixtures.
 */

import { jest } from '@jest/globals';

import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.types.js';
import type { INetworkDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Network/Types/Discovery.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/Types/Endpoint.js';
import {
  extractSessionToken,
  primeSessionToken,
} from '../../../../../Scrapers/Pipeline/Phases/BindApiMediator/BindApiMediatorSessionToken.js';
import { isSome } from '../../../../../Scrapers/Pipeline/Types/Option.js';

/** Local mirror of the per-bank session-token capture spec. */
interface ISessionSpec {
  readonly urlMatch: string;
  readonly bodyField?: string;
  readonly tokenPath: readonly string[];
}

/** Local mirror of the registry bank-config shape (import is DI-restricted). */
interface ITestBankConfig {
  readonly urls: { readonly base: string };
  readonly balanceKind: 'account' | 'card-cycle';
  readonly authStrategyKind: 'token' | 'session-cookie' | 'api-direct';
  readonly sessionTokenCapture?: ISessionSpec;
}

const LEUMI_URL = 'https://hb2.bankleumi.co.il/ChannelWCF/Broker.svc/ProcessRequest';
const FAKE_SESSION_ID = 'fakesession0000111122223333aaaa';
const WCF_SPEC: ISessionSpec = {
  urlMatch: 'Broker.svc/ProcessRequest',
  bodyField: 'reqObj',
  tokenPath: ['SessionHeader', 'SessionID'],
};
const FLAT_SPEC: ISessionSpec = {
  urlMatch: 'Broker.svc/ProcessRequest',
  tokenPath: ['SessionHeader', 'SessionID'],
};

/**
 * Build a captured endpoint literal for the fake pool.
 * @param url - Request URL.
 * @param method - HTTP method.
 * @param postData - Serialized request body.
 * @returns Discovered-endpoint-shaped fixture.
 */
function makeEndpoint(url: string, method: string, postData: string): IDiscoveredEndpoint {
  return { url, method, postData } as unknown as IDiscoveredEndpoint;
}

/**
 * Serialize a double-encoded WCF postData carrying the session id in `reqObj`.
 * @param sessionId - Session id to embed.
 * @returns Stringified `{ moduleName, reqObj, version }` body.
 */
function wcfBody(sessionId: string): string {
  const reqObj = JSON.stringify({ SessionHeader: { SessionID: sessionId, FIID: 'Leumi' } });
  return JSON.stringify({ moduleName: 'UC_SO_GetAccounts', reqObj, version: 'Infra_V2.0' });
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
 * Build a minimal bank config, optionally declaring the capture spec.
 * @param sessionTokenCapture - Capture spec, or undefined to opt out.
 * @returns Registry-shaped config literal.
 */
function makeConfig(sessionTokenCapture?: ISessionSpec): ITestBankConfig {
  return {
    urls: { base: LEUMI_URL },
    balanceKind: 'account',
    authStrategyKind: 'session-cookie',
    sessionTokenCapture,
  };
}

describe('BIND-API-MEDIATOR session-token prime — extractSessionToken', () => {
  it('EXTRACT-1 decodes a double-encoded WCF reqObj token', () => {
    const body = wcfBody(FAKE_SESSION_ID);
    const endpoint = makeEndpoint(LEUMI_URL, 'POST', body);
    const token = extractSessionToken([endpoint], WCF_SPEC);
    expect(token).toBe(FAKE_SESSION_ID);
  });

  it('EXTRACT-2 reads a flat JSON body when no bodyField is declared', () => {
    const flat = JSON.stringify({ SessionHeader: { SessionID: 'flat-token-9999' } });
    const endpoint = makeEndpoint(LEUMI_URL, 'POST', flat);
    const token = extractSessionToken([endpoint], FLAT_SPEC);
    expect(token).toBe('flat-token-9999');
  });

  it('EXTRACT-3 ignores captures whose URL does not match', () => {
    const body = wcfBody(FAKE_SESSION_ID);
    const endpoint = makeEndpoint('https://other.example.co.il/api', 'POST', body);
    const token = extractSessionToken([endpoint], WCF_SPEC);
    expect(token).toBe(false);
  });

  it('EXTRACT-4 ignores non-POST captures', () => {
    const body = wcfBody(FAKE_SESSION_ID);
    const endpoint = makeEndpoint(LEUMI_URL, 'GET', body);
    const token = extractSessionToken([endpoint], WCF_SPEC);
    expect(token).toBe(false);
  });

  it('EXTRACT-5 tolerates malformed postData', () => {
    const endpoint = makeEndpoint(LEUMI_URL, 'POST', 'not-json{');
    const token = extractSessionToken([endpoint], WCF_SPEC);
    expect(token).toBe(false);
  });

  it('EXTRACT-6 returns false when the token path is absent', () => {
    const body = wcfBody(FAKE_SESSION_ID);
    const endpoint = makeEndpoint(LEUMI_URL, 'POST', body);
    const missing: ISessionSpec = { ...WCF_SPEC, tokenPath: ['SessionHeader', 'Missing'] };
    const token = extractSessionToken([endpoint], missing);
    expect(token).toBe(false);
  });

  it('EXTRACT-7 returns the first matching token across a mixed pool', () => {
    const noiseGet = makeEndpoint(LEUMI_URL, 'GET', '');
    const noisePost = makeEndpoint('https://noise.example/x', 'POST', '{}');
    const body = wcfBody(FAKE_SESSION_ID);
    const match = makeEndpoint(LEUMI_URL, 'POST', body);
    const token = extractSessionToken([noiseGet, noisePost, match], WCF_SPEC);
    expect(token).toBe(FAKE_SESSION_ID);
  });

  it('EXTRACT-8 ignores a null JSON body', () => {
    const endpoint = makeEndpoint(LEUMI_URL, 'POST', 'null');
    const token = extractSessionToken([endpoint], FLAT_SPEC);
    expect(token).toBe(false);
  });

  it('EXTRACT-9 ignores a non-object JSON body', () => {
    const endpoint = makeEndpoint(LEUMI_URL, 'POST', '42');
    const token = extractSessionToken([endpoint], FLAT_SPEC);
    expect(token).toBe(false);
  });

  it('EXTRACT-10 ignores a JSON array body', () => {
    const endpoint = makeEndpoint(LEUMI_URL, 'POST', '[]');
    const token = extractSessionToken([endpoint], FLAT_SPEC);
    expect(token).toBe(false);
  });

  it('EXTRACT-11 ignores a non-string reqObj field', () => {
    const body = JSON.stringify({ reqObj: { SessionHeader: { SessionID: 'x' } } });
    const endpoint = makeEndpoint(LEUMI_URL, 'POST', body);
    const token = extractSessionToken([endpoint], WCF_SPEC);
    expect(token).toBe(false);
  });

  it('EXTRACT-12 stops when the path dead-ends before its last key', () => {
    const flat = JSON.stringify({ SessionHeader: 'not-an-object' });
    const endpoint = makeEndpoint(LEUMI_URL, 'POST', flat);
    const deep: ISessionSpec = {
      ...FLAT_SPEC,
      tokenPath: ['SessionHeader', 'SessionID', 'Nested'],
    };
    const token = extractSessionToken([endpoint], deep);
    expect(token).toBe(false);
  });

  it('EXTRACT-13 rejects an empty-string token leaf', () => {
    const flat = JSON.stringify({ SessionHeader: { SessionID: '' } });
    const endpoint = makeEndpoint(LEUMI_URL, 'POST', flat);
    const token = extractSessionToken([endpoint], FLAT_SPEC);
    expect(token).toBe(false);
  });
});

describe('BIND-API-MEDIATOR session-token prime — primeSessionToken', () => {
  it('PRIME-1 stashes the captured token for opted-in banks', () => {
    const body = wcfBody(FAKE_SESSION_ID);
    const endpoint = makeEndpoint(LEUMI_URL, 'POST', body);
    const network = makeNetwork([endpoint]);
    const mediator = makeMediator({});
    const config = makeConfig(WCF_SPEC);
    const outcome = primeSessionToken(config, network, mediator);
    const isPresent = isSome(outcome);
    expect(isPresent).toBe(true);
    expect(mediator.setSessionContext).toHaveBeenCalledWith({ sessionToken: FAKE_SESSION_ID });
  });

  it('PRIME-2 merges the token into the existing context', () => {
    const body = wcfBody(FAKE_SESSION_ID);
    const endpoint = makeEndpoint(LEUMI_URL, 'POST', body);
    const network = makeNetwork([endpoint]);
    const mediator = makeMediator({ token: 'jwt-abc' });
    const config = makeConfig(WCF_SPEC);
    primeSessionToken(config, network, mediator);
    expect(mediator.setSessionContext).toHaveBeenCalledWith({
      token: 'jwt-abc',
      sessionToken: FAKE_SESSION_ID,
    });
  });

  it('PRIME-3 is a no-op when no capture spec is declared', () => {
    const body = wcfBody(FAKE_SESSION_ID);
    const endpoint = makeEndpoint(LEUMI_URL, 'POST', body);
    const network = makeNetwork([endpoint]);
    const mediator = makeMediator({});
    const config = makeConfig();
    const outcome = primeSessionToken(config, network, mediator);
    const isPresent = isSome(outcome);
    expect(isPresent).toBe(false);
    expect(mediator.setSessionContext).not.toHaveBeenCalled();
  });
});
