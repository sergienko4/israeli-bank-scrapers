/**
 * N26 — the origin-scoped dynamic client certificate. A holder is looked up on
 * every request: the bank origin gets the installed certificate, any other
 * origin (or no certificate) gets a plain agent that presents none. Runs over
 * real loopback TLS: each server reports the SHA-256 of the certificate it was
 * shown. Install swaps agents and destroys the old one; clear drops it; a 302
 * is never followed; the mocked-transport seam is told what would be presented.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type AgentBuilder,
  createClientCertHolder,
  type IClientCertHolder,
} from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/ClientCertHolder.js';
import { MtlsFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsFetchStrategy.js';
import {
  makeMtlsInvoke,
  setMtlsFetchFallback,
} from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsTransport.js';
import type { ICertBundle } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/OneZeroClientCert.js';
import { isOk, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { issueTestCert, type ITestCert } from '../../../../../Helpers/TestCertificate.js';
import {
  buildTrustingAgent,
  type IPeerEcho,
  type IPeerServer,
  recordPresented,
  startPeerServer,
} from './ClientCertTestServer.js';

const GET_INIT: RequestInit = { method: 'GET', headers: {} };

const CERT_A: ITestCert = issueTestCert({ commonName: 'device-a' });
const CERT_B: ITestCert = issueTestCert({ commonName: 'device-b' });
const PAIR_A: ICertBundle = { key: CERT_A.keyPem, cert: CERT_A.certPem };
const PAIR_B: ICertBundle = { key: CERT_B.keyPem, cert: CERT_B.certPem };
const INSTALLED = succeed(true);

/** Agents that trust the loopback server identity. */
const TRUSTING_AGENT: AgentBuilder = buildTrustingAgent;

/**
 * GET `/peer` through the holder and read what the server was shown.
 * @param holder - The holder under test.
 * @param origin - Server origin.
 * @returns SHA-256 hex the server saw, `''` for none.
 */
async function presentedTo(holder: IClientCertHolder, origin: string): Promise<string> {
  const invoke = makeMtlsInvoke(holder.source);
  const result = await invoke(`${origin}/peer`, GET_INIT, 'GET');
  if (!isOk(result)) return result.errorMessage;
  const echo = (await result.value.json()) as IPeerEcho;
  return echo.sha256;
}

describe('ClientCertHolder — origin-scoped dynamic client certificate', () => {
  let bank: IPeerServer;
  let foreign: IPeerServer;
  let holder: IClientCertHolder;

  beforeAll(async () => {
    bank = await startPeerServer();
    foreign = await startPeerServer();
  });
  afterAll(async () => {
    await bank.close();
    await foreign.close();
  });
  beforeEach(() => {
    holder = createClientCertHolder(bank.origin, TRUSTING_AGENT);
  });
  afterEach(() => {
    holder.control.clear();
    setMtlsFetchFallback();
  });

  it('presents no certificate before one is installed', async () => {
    const seen = await presentedTo(holder, bank.origin);
    expect(seen).toBe('');
  });

  it('presents the installed certificate to the bank origin', async () => {
    const installed = holder.control.install(PAIR_A);
    const seen = await presentedTo(holder, bank.origin);
    expect(installed).toEqual(INSTALLED);
    expect(seen).toBe(CERT_A.sha256);
  });

  it('presents no certificate to another origin', async () => {
    holder.control.install(PAIR_A);
    const seen = await presentedTo(holder, foreign.origin);
    expect(seen).toBe('');
  });

  it('presents no certificate after clear', async () => {
    holder.control.install(PAIR_A);
    const wasCleared = holder.control.clear();
    const seen = await presentedTo(holder, bank.origin);
    expect(wasCleared).toBe(true);
    expect(seen).toBe('');
  });

  it('a swap presents the new certificate and destroys the old agent', async () => {
    holder.control.install(PAIR_A);
    const { agent: previous } = holder.source(`${bank.origin}/peer`);
    const destroy = jest.spyOn(previous, 'destroy');
    holder.control.install(PAIR_B);
    const seen = await presentedTo(holder, bank.origin);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(seen).toBe(CERT_B.sha256);
  });

  it('clear destroys the installed agent', () => {
    holder.control.install(PAIR_A);
    const { agent: installed } = holder.source(`${bank.origin}/peer`);
    const destroy = jest.spyOn(installed, 'destroy');
    holder.control.clear();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it.each<[string, ICertBundle]>([
    ['a key that does not match', { key: CERT_B.keyPem, cert: CERT_A.certPem }],
    ['a certificate that is not PEM', { key: CERT_A.keyPem, cert: 'not a certificate' }],
    ['a key that is not PEM', { key: 'not a key', cert: CERT_A.certPem }],
  ])('refuses %s and keeps the installed certificate', async (_label, pair) => {
    holder.control.install(PAIR_B);
    const refused = holder.control.install(pair);
    const seen = await presentedTo(holder, bank.origin);
    expect(refused).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'client certificate invalid',
    });
    expect(seen).toBe(CERT_B.sha256);
  });

  it('never follows a 302: it surfaces as an HTTP failure', async () => {
    holder.control.install(PAIR_A);
    bank.seen.length = 0;
    const strategy = new MtlsFetchStrategy(`${bank.origin}/`, holder.source);
    const result = await strategy.fetchGet(`${bank.origin}/redirect`, { extraHeaders: {} });
    expect(result).toMatchObject({ success: false });
    if (!isOk(result)) expect(result.errorMessage).toContain('302');
    expect(bank.seen).toEqual(['/redirect']);
  });

  it('tells the mocked-transport seam what each URL would be shown', async () => {
    const presented = recordPresented();
    holder.control.install(PAIR_A);
    bank.seen.length = 0;
    const invoke = makeMtlsInvoke(holder.source);
    await invoke(`${bank.origin}/peer`, GET_INIT, 'GET');
    await invoke(`${foreign.origin}/peer`, GET_INIT, 'GET');
    expect(presented).toEqual([{ sha256: CERT_A.sha256 }, false]);
    expect(bank.seen).toEqual([]);
  });
});
