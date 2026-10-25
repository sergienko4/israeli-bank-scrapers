/**
 * Session-protocol pin. The loopback cases run a real handshake through the
 * transport agent against a server capped at TLS 1.2 that can sign the
 * handshake only with `rsa_pkcs1_sha1`, which the Android profile still offers
 * for its fingerprint. They prove the pin, not the profile, refuses that
 * session, and that it does so before the request reaches the server.
 */

import { Agent, type ServerOptions } from 'node:https';
import { PassThrough } from 'node:stream';
import { setImmediate as nextTurn } from 'node:timers/promises';

import { buildMtlsAgent } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsTransport.js';
import {
  guardSessionProtocol,
  SESSION_PROTOCOL_REASON,
} from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Tls/SessionProtocolAgent.js';
import { getTlsClientProfile } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Tls/TlsClientProfiles.js';
import { MTLS_TEST_CERT_B64, MTLS_TEST_KEY_B64 } from '../Mtls/MtlsTestCertData.js';
import { decodePem } from '../Mtls/MtlsTestServer.js';
import { fetchOutcome, type IRequestOutcome, startLeafServer } from './TlsLoopbackServer.js';

/** Outcome of one request plus the requests the server answered. */
interface IRoundTrip {
  readonly outcome: IRequestOutcome;
  readonly requests: number;
}

/** Trust the self-signed RSA loopback identity; a SHA-1 RSA signature needs an RSA key. */
const TRUST_SELF = { ca: decodePem(MTLS_TEST_CERT_B64) };

/** A TLS 1.2 server that can sign the handshake only with SHA-1. */
const TLS12_SHA1: ServerOptions = {
  maxVersion: 'TLSv1.2',
  ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:@SECLEVEL=0',
  sigalgs: 'rsa_pkcs1_sha1',
};

/** A TLS 1.2 server with its default (SHA-2) handshake signatures. */
const TLS12_DEFAULT: ServerOptions = { maxVersion: 'TLSv1.2' };

/** The request completed and reached the server once. */
const COMPLETED: IRoundTrip = { outcome: { status: 200, error: '' }, requests: 1 };

/**
 * Send one request through an agent to a fresh loopback server, then release both.
 * @param agent - Agent under test.
 * @param tls - Server TLS options.
 * @returns The request outcome and the requests the server answered.
 */
async function roundTrip(agent: Agent, tls: ServerOptions): Promise<IRoundTrip> {
  const server = await startLeafServer(MTLS_TEST_CERT_B64, MTLS_TEST_KEY_B64, tls);
  const outcome = await fetchOutcome(server.port, agent, TRUST_SELF);
  const requests = server.requests();
  await server.close();
  agent.destroy();
  return { outcome, requests };
}

describe('SessionProtocolAgent — enforced by the transport agent on a real handshake', () => {
  it('refuses a TLS 1.2 SHA-1 handshake before the request reaches the server', async () => {
    const agent = buildMtlsAgent(false, 'android-11-okhttp');
    const result = await roundTrip(agent, TLS12_SHA1);
    const refused = { status: 0, error: SESSION_PROTOCOL_REASON };
    expect(result).toEqual({ outcome: refused, requests: 0 });
  });

  it('is what refuses it: the profile alone completes the SHA-1 handshake', async () => {
    const { options } = getTlsClientProfile('android-11-okhttp');
    const profileOnly = new Agent({ ...options, keepAlive: false });
    const result = await roundTrip(profileOnly, TLS12_SHA1);
    expect(result).toEqual(COMPLETED);
  });

  it('completes the request once the same server may negotiate TLS 1.3', async () => {
    const agent = buildMtlsAgent(false, 'android-11-okhttp');
    const result = await roundTrip(agent, {});
    expect(result).toEqual(COMPLETED);
  });

  it('lets the node-default agent settle on TLS 1.2', async () => {
    const agent = buildMtlsAgent(false);
    const result = await roundTrip(agent, TLS12_DEFAULT);
    expect(result).toEqual(COMPLETED);
  });
});

describe('SessionProtocolAgent.guardSessionProtocol', () => {
  it('refuses a connection that cannot report its protocol', async () => {
    const stream = new PassThrough();
    const errors: Error[] = [];
    stream.on('error', (error: Error) => {
      errors.push(error);
    });
    guardSessionProtocol(stream, 'TLSv1.3');
    await nextTurn();
    const refusal = new Error(SESSION_PROTOCOL_REASON);
    expect({ isDestroyed: stream.destroyed, errors }).toEqual({
      isDestroyed: true,
      errors: [refusal],
    });
  });
});
