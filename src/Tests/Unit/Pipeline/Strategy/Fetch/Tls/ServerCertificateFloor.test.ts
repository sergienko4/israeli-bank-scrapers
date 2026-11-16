/**
 * Server-certificate floor. The structural cases walk hand-built chains of real
 * fixture certificates; the loopback cases run a real TLS handshake through the
 * transport agent, so they prove Node calls the floor on the live peer chain
 * and that the Android profile, whose `@SECLEVEL=0` accepts a weak chain on its
 * own, no longer does once the floor runs.
 */

import { Agent } from 'node:https';

import buildMtlsAgent from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsTransport.js';
import { getTlsClientProfile } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Tls/TlsClientProfiles.js';
import { decodePem } from '../Mtls/MtlsTestServer.js';
import {
  FLOOR_CA_CERT_B64,
  FLOOR_GOOD_CERT_B64,
  FLOOR_GOOD_KEY_B64,
  FLOOR_SHA1_CERT_B64,
  FLOOR_WEAK_KEY_CERT_B64,
  FLOOR_WEAK_KEY_KEY_B64,
} from './ServerCertificateFloorTestData.js';
import { fetchOutcome, startLeafServer } from './TlsLoopbackServer.js';

/** Trust only the fixture CA for every loopback request. */
const TRUST_CA = { ca: decodePem(FLOOR_CA_CERT_B64) };

describe('ServerCertificateFloor — enforced by the transport agent on a real handshake', () => {
  let agent: Agent;

  beforeEach(() => {
    agent = buildMtlsAgent(false, 'android-11-okhttp');
  });
  afterEach(() => {
    agent.destroy();
  });

  it('completes the request for a chain above the floor', async () => {
    const server = await startLeafServer(FLOOR_GOOD_CERT_B64, FLOOR_GOOD_KEY_B64);
    const outcome = await fetchOutcome(server.port, agent, TRUST_CA);
    const requests = server.requests();
    await server.close();
    expect({ outcome, requests }).toEqual({ outcome: { status: 200, error: '' }, requests: 1 });
  });

  const weakLeaves = [
    { name: 'an RSA-1024 leaf', certB64: FLOOR_WEAK_KEY_CERT_B64, keyB64: FLOOR_WEAK_KEY_KEY_B64 },
    { name: 'a SHA-1 signed leaf', certB64: FLOOR_SHA1_CERT_B64, keyB64: FLOOR_GOOD_KEY_B64 },
  ];

  it.each(weakLeaves)(
    'refuses $name before the request reaches the server',
    async ({ certB64, keyB64 }) => {
      const server = await startLeafServer(certB64, keyB64);
      const outcome = await fetchOutcome(server.port, agent, TRUST_CA);
      const requests = server.requests();
      await server.close();
      const refused = {
        status: 0,
        error: 'server certificate chain is below the TLS security floor (weak key or signature)',
      };
      expect({ outcome, requests }).toEqual({ outcome: refused, requests: 0 });
    },
  );

  it.each(weakLeaves)(
    'is what refuses $name: the profile alone accepts it',
    async ({ certB64, keyB64 }) => {
      const { options } = getTlsClientProfile('android-11-okhttp');
      const profileOnly = new Agent({ ...options, keepAlive: false });
      const server = await startLeafServer(certB64, keyB64);
      const outcome = await fetchOutcome(server.port, profileOnly, TRUST_CA);
      profileOnly.destroy();
      await server.close();
      expect(outcome).toEqual({ status: 200, error: '' });
    },
  );

  it('still runs the hostname check first', async () => {
    const server = await startLeafServer(FLOOR_GOOD_CERT_B64, FLOOR_GOOD_KEY_B64);
    const outcome = await fetchOutcome(server.port, agent, {
      ...TRUST_CA,
      servername: 'mismatch.test',
    });
    const requests = server.requests();
    await server.close();
    expect(outcome.error).toContain("does not match certificate's altnames");
    expect(requests).toBe(0);
  });
});
