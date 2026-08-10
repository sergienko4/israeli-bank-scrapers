/**
 * Unit tests for Strategy/Fetch/Mtls/MtlsTransport — the node:https client-cert
 * transport. Runs against a local HTTPS server that simulates the Cloudflare
 * mutual-TLS gate (no client cert => 403, client cert => 200). Covers agent
 * construction, the cert=>200 / no-cert=>403 split, cookie passthrough, header
 * normalisation branches, socket-failure handling, and the makeMtlsInvoke seam.
 */

import type { IncomingMessage } from 'node:http';
import { Agent } from 'node:https';

import {
  buildMtlsAgent,
  makeMtlsInvoke,
  mtlsInvoke,
  toResponse,
} from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsTransport.js';
import { isOk } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import type { IGateServer } from './MtlsTestServer.js';
import {
  buildCertAgent,
  buildNoCertAgent,
  GATE_COOKIES,
  startGateServer,
  testCertBundle,
} from './MtlsTestServer.js';

/** Echo payload shape returned by the gate on a 200 REST response. */
interface IEcho {
  readonly ok: boolean;
  readonly method: string;
}

describe('MtlsTransport.buildMtlsAgent', () => {
  it('returns an Agent carrying the cert/key with keep-alive disabled', () => {
    const bundle = testCertBundle();
    const agent = buildMtlsAgent(bundle);
    const isAgent = agent instanceof Agent;
    expect(isAgent).toBe(true);
    const options = agent.options;
    expect(options.cert).toBe(bundle.cert);
    expect(options.key).toBe(bundle.key);
    expect(options.keepAlive).toBe(false);
    agent.destroy();
  });
});

describe('MtlsTransport.mtlsInvoke — against the simulated mTLS gate', () => {
  let server: IGateServer;
  let certAgent: Agent;
  let noCertAgent: Agent;

  beforeAll(async () => {
    server = await startGateServer();
  });
  afterAll(async () => {
    await server.close();
  });
  beforeEach(() => {
    const bundle = testCertBundle();
    certAgent = buildCertAgent(bundle);
    noCertAgent = buildNoCertAgent();
  });
  afterEach(() => {
    certAgent.destroy();
    noCertAgent.destroy();
  });

  it('presents the client cert and yields a 200 Response with parsed body', async () => {
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    };
    const result = await mtlsInvoke({ agent: certAgent, url: server.restUrl, init, verb: 'POST' });
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) {
      const response = result.value;
      expect(response.status).toBe(200);
      const text = await response.text();
      const parsed = JSON.parse(text) as IEcho;
      expect(parsed.ok).toBe(true);
      expect(parsed.method).toBe('POST');
    }
  });

  it('exposes every Set-Cookie line via Response.getSetCookie()', async () => {
    const init: RequestInit = { method: 'POST', headers: {}, body: '{}' };
    const result = await mtlsInvoke({ agent: certAgent, url: server.restUrl, init, verb: 'POST' });
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) {
      const cookies = result.value.headers.getSetCookie();
      expect(cookies).toEqual([...GATE_COOKIES]);
    }
  });

  it('normalises array-form headers and sends a bodyless GET (200)', async () => {
    const init: RequestInit = { method: 'GET', headers: [['x-test', '1']] };
    const result = await mtlsInvoke({ agent: certAgent, url: server.restUrl, init, verb: 'GET' });
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value.status).toBe(200);
  });

  it('tolerates undefined headers on a POST (200)', async () => {
    const init: RequestInit = { method: 'POST', body: '{}' };
    const result = await mtlsInvoke({ agent: certAgent, url: server.restUrl, init, verb: 'POST' });
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value.status).toBe(200);
  });

  it('normalises a Headers instance into a plain record (200)', async () => {
    const headers = new Headers({ 'x-h': '1' });
    const init: RequestInit = { method: 'POST', headers, body: '{}' };
    const result = await mtlsInvoke({ agent: certAgent, url: server.restUrl, init, verb: 'POST' });
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value.status).toBe(200);
  });

  it('returns the raw 403 Response (no classification) when no cert is presented', async () => {
    const init: RequestInit = { method: 'POST', headers: {}, body: '{}' };
    const result = await mtlsInvoke({
      agent: noCertAgent,
      url: server.restUrl,
      init,
      verb: 'POST',
    });
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value.status).toBe(403);
  });

  it('fails with an "mtls error" Procedure when the socket cannot connect', async () => {
    const init: RequestInit = { method: 'GET', headers: {} };
    const result = await mtlsInvoke({
      agent: certAgent,
      url: 'https://127.0.0.1:1/',
      init,
      verb: 'GET',
    });
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) expect(result.errorMessage).toContain('mtls error');
  });
});

describe('MtlsTransport.makeMtlsInvoke', () => {
  let server: IGateServer;
  let certAgent: Agent;

  beforeAll(async () => {
    server = await startGateServer();
  });
  afterAll(async () => {
    await server.close();
  });
  beforeEach(() => {
    const bundle = testCertBundle();
    certAgent = buildCertAgent(bundle);
  });
  afterEach(() => {
    certAgent.destroy();
  });

  it('binds the agent into a FetchInvoke that reaches the gate (200)', async () => {
    const invoke = makeMtlsInvoke(certAgent);
    const init: RequestInit = { method: 'POST', headers: {}, body: '{}' };
    const result = await invoke(server.restUrl, init, 'POST');
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value.status).toBe(200);
  });
});

describe('MtlsTransport.toResponse — defensive header branches', () => {
  it('joins array headers and coalesces missing header values', () => {
    const fakeHeaders = {
      'x-multi': ['a', 'b'],
      'x-empty': undefined,
      'set-cookie': ['sid=1', 'csrf=2'],
    };
    const message = { statusCode: 200, headers: fakeHeaders } as unknown as IncomingMessage;
    const response = toResponse(message, 'body-text');
    expect(response.status).toBe(200);
    const multi = response.headers.get('x-multi');
    expect(multi).toBe('a, b');
    const empty = response.headers.get('x-empty');
    expect(empty).toBe('');
    const cookies = response.headers.getSetCookie();
    expect(cookies).toEqual(['sid=1', 'csrf=2']);
  });
});
