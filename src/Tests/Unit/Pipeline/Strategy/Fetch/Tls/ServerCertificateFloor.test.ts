/**
 * Server-certificate floor. The structural cases walk hand-built chains of real
 * fixture certificates; the loopback cases run a real TLS handshake through the
 * transport agent, so they prove Node calls the floor on the live peer chain
 * and that the Android profile, whose `@SECLEVEL=0` accepts a weak chain on its
 * own, no longer does once the floor runs.
 */

import { X509Certificate } from 'node:crypto';
import { Agent } from 'node:https';

import { buildMtlsAgent } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsTransport.js';
import {
  type IChainLink,
  isServerChainAboveFloor,
  SERVER_CERT_FLOOR_REASON,
} from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Tls/ServerCertificateFloor.js';
import { getTlsClientProfile } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Tls/TlsClientProfiles.js';
import { decodePem } from '../Mtls/MtlsTestServer.js';
import {
  FLOOR_CA_CERT_B64,
  FLOOR_DSA_Q160_CERT_B64,
  FLOOR_DSA_Q224_CERT_B64,
  FLOOR_ECDSA_CERT_B64,
  FLOOR_ED25519_CERT_B64,
  FLOOR_GOOD_CERT_B64,
  FLOOR_GOOD_KEY_B64,
  FLOOR_PSS_SHA1_CERT_B64,
  FLOOR_PSS_SHA256_CERT_B64,
  FLOOR_SHA1_CERT_B64,
  FLOOR_WEAK_KEY_CERT_B64,
  FLOOR_WEAK_KEY_KEY_B64,
} from './ServerCertificateFloorTestData.js';
import { fetchOutcome, startLeafServer } from './TlsLoopbackServer.js';

/** A chain link the tests can close into a loop after creation. */
interface IOpenLink {
  readonly raw: Buffer;
  issuerCertificate?: IChainLink;
}

/**
 * DER bytes of a base64-wrapped PEM fixture.
 * @param b64 - Fixture constant.
 * @returns The certificate's DER encoding.
 */
function derOf(b64: string): Buffer {
  const pem = decodePem(b64);
  const certificate = new X509Certificate(pem);
  return certificate.raw;
}

/**
 * A link with no issuer, as Node reports a chain that ends at a cross-sign.
 * @param b64 - Fixture constant.
 * @returns The open link.
 */
function loneLink(b64: string): IOpenLink {
  const raw = derOf(b64);
  return { raw };
}

/**
 * A self-signed trust anchor, which Node reports as its own issuer.
 * @param b64 - Fixture constant.
 * @returns The self-looped link.
 */
function anchorLink(b64: string): IChainLink {
  const link = loneLink(b64);
  link.issuerCertificate = link;
  return link;
}

/**
 * A leaf issued by the fixture CA anchor.
 * @param b64 - Leaf fixture constant.
 * @returns The leaf with its anchor.
 */
function leafUnderCa(b64: string): IChainLink {
  const issuerCertificate = anchorLink(FLOOR_CA_CERT_B64);
  const raw = derOf(b64);
  return { raw, issuerCertificate };
}

describe('ServerCertificateFloor.isServerChainAboveFloor', () => {
  it.each([
    { name: 'a P-256 SHA-256 leaf under a SHA-1 self-signed anchor', b64: FLOOR_GOOD_CERT_B64 },
    { name: 'a leaf signed RSASSA-PSS with SHA-256', b64: FLOOR_PSS_SHA256_CERT_B64 },
    { name: 'a DSA-2048 leaf over a 224-bit q', b64: FLOOR_DSA_Q224_CERT_B64 },
  ])('accepts $name', ({ b64 }) => {
    const leaf = leafUnderCa(b64);
    const isAbove = isServerChainAboveFloor(leaf);
    expect(isAbove).toBe(true);
  });

  it.each([
    { name: 'an RSA-1024 leaf', b64: FLOOR_WEAK_KEY_CERT_B64 },
    { name: 'a SHA-1 signed leaf', b64: FLOOR_SHA1_CERT_B64 },
    { name: 'a leaf signed RSASSA-PSS with the SHA-1 default', b64: FLOOR_PSS_SHA1_CERT_B64 },
    { name: 'a DSA-2048 leaf over a 160-bit q', b64: FLOOR_DSA_Q160_CERT_B64 },
  ])('rejects $name', ({ b64 }) => {
    const leaf = leafUnderCa(b64);
    const isAbove = isServerChainAboveFloor(leaf);
    expect(isAbove).toBe(false);
  });

  it.each([
    { name: 'an Ed25519 link', b64: FLOOR_ED25519_CERT_B64, isAbove: true },
    { name: 'an ECDSA SHA-256 link', b64: FLOOR_ECDSA_CERT_B64, isAbove: true },
    { name: 'a SHA-1 signed leaf', b64: FLOOR_SHA1_CERT_B64, isAbove: false },
    {
      name: 'a SHA-1 signed CA that is not its own issuer',
      b64: FLOOR_CA_CERT_B64,
      isAbove: false,
    },
  ])('checks the signature of $name that ends the chain without an issuer', ({ b64, isAbove }) => {
    const link = loneLink(b64);
    const isLinkAbove = isServerChainAboveFloor(link);
    expect(isLinkAbove).toBe(isAbove);
  });

  it('checks the key of a self-signed anchor', () => {
    const anchor = anchorLink(FLOOR_WEAK_KEY_CERT_B64);
    const isAbove = isServerChainAboveFloor(anchor);
    expect(isAbove).toBe(false);
  });

  it('rejects a link it cannot parse', () => {
    const raw = Buffer.from([0x30, 0x00]);
    const isAbove = isServerChainAboveFloor({ raw });
    expect(isAbove).toBe(false);
  });

  it('stops at an issuer cycle and still checks every link in it', () => {
    const leaf = loneLink(FLOOR_GOOD_CERT_B64);
    const issuer = loneLink(FLOOR_ECDSA_CERT_B64);
    leaf.issuerCertificate = issuer;
    issuer.issuerCertificate = leaf;
    const isStrongCycleAbove = isServerChainAboveFloor(leaf);
    const weakIssuer = loneLink(FLOOR_SHA1_CERT_B64);
    leaf.issuerCertificate = weakIssuer;
    weakIssuer.issuerCertificate = leaf;
    const isWeakCycleAbove = isServerChainAboveFloor(leaf);
    expect({ isStrongCycleAbove, isWeakCycleAbove }).toEqual({
      isStrongCycleAbove: true,
      isWeakCycleAbove: false,
    });
  });
});

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
      const refused = { status: 0, error: SERVER_CERT_FLOOR_REASON };
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
