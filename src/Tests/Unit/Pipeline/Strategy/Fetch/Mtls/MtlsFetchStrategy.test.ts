/**
 * Integration-style unit tests for the mTLS fetch strategies. Both extend the
 * shared NativeFetchStrategy/GraphQLFetchStrategy pipeline and only swap the
 * transport seam for a client-cert agent. Runs against the local mTLS-gate
 * server: a cert agent yields parsed 200 bodies + Set-Cookie emission; a
 * cert-less agent yields the shared non-2xx classification (a 403 failure).
 */

import type { Agent } from 'node:https';

import { MtlsFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsFetchStrategy.js';
import { MtlsGraphQLFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsGraphQLFetchStrategy.js';
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

/** GraphQL envelope shape returned by the gate on a 200 graphql response. */
interface IGqlEnvelope {
  readonly data: { readonly me: string };
}

describe('MtlsFetchStrategy — REST over the mTLS gate', () => {
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

  it('POSTs with the client cert and parses the 200 body', async () => {
    const strategy = new MtlsFetchStrategy(server.baseUrl, certAgent);
    const result = await strategy.fetchPost<IEcho>(
      server.restUrl,
      { a: '1' },
      { extraHeaders: {} },
    );
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value).toEqual({ ok: true, method: 'POST' });
  });

  it('emits Set-Cookie lines through the inherited onSetCookie hook', async () => {
    const captured: string[][] = [];
    /**
     * Cookie-emit spy recording the raw Set-Cookie payload.
     * @param lines - Raw Set-Cookie lines from the response.
     * @returns The count of lines absorbed.
     */
    const onSetCookie = (lines: readonly string[]): number => {
      captured.push([...lines]);
      return lines.length;
    };
    const strategy = new MtlsFetchStrategy(server.baseUrl, certAgent);
    const result = await strategy.fetchPost(
      server.restUrl,
      { a: '1' },
      { extraHeaders: {}, onSetCookie },
    );
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual([...GATE_COOKIES]);
  });

  it('classifies a cert-less 403 into a failure carrying the status', async () => {
    const strategy = new MtlsFetchStrategy(server.baseUrl, noCertAgent);
    const result = await strategy.fetchPost(server.restUrl, { a: '1' }, { extraHeaders: {} });
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) expect(result.errorMessage).toContain('403');
  });
});

describe('MtlsGraphQLFetchStrategy — GraphQL over the mTLS gate', () => {
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

  it('queries with the client cert and returns the {data} envelope', async () => {
    const strategy = new MtlsGraphQLFetchStrategy(server.gqlUrl, certAgent);
    const result = await strategy.query<IGqlEnvelope>('{ me }', {});
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value).toEqual({ data: { me: 'ok' } });
  });

  it('merges constructor default headers and still succeeds (200)', async () => {
    const strategy = new MtlsGraphQLFetchStrategy(server.gqlUrl, certAgent, { 'x-def': '1' });
    const result = await strategy.query<IGqlEnvelope>('{ me }', {});
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value.data.me).toBe('ok');
  });

  it('classifies a cert-less 403 into a failure carrying the status', async () => {
    const strategy = new MtlsGraphQLFetchStrategy(server.gqlUrl, noCertAgent);
    const result = await strategy.query('{ me }', {});
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) expect(result.errorMessage).toContain('403');
  });
});
