/**
 * DER signature-algorithm reader — every fixture's OID matches what Node's own
 * X.509 parser reports (`X509Certificate#signatureAlgorithmOid`, checked when
 * the fixtures were generated), and no malformed input escapes as a throw.
 */

import { X509Certificate } from 'node:crypto';

import { readSignatureAlgorithm } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Tls/DerSignatureAlgorithm.js';
import { decodePem } from '../Mtls/MtlsTestServer.js';
import {
  FLOOR_CA_CERT_B64,
  FLOOR_ECDSA_CERT_B64,
  FLOOR_ED25519_CERT_B64,
  FLOOR_GOOD_CERT_B64,
  FLOOR_PSS_SHA1_CERT_B64,
  FLOOR_PSS_SHA256_CERT_B64,
  FLOOR_SHA1_CERT_B64,
} from './ServerCertificateFloorTestData.js';

/** Result for anything the reader cannot parse. */
const UNREADABLE = { oid: '', pssHashOid: '' };

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

/** One fixture and the algorithm the reader must report for it. */
interface ISignatureCase {
  readonly name: string;
  readonly b64: string;
  readonly oid: string;
  readonly pssHashOid: string;
}

const SIGNATURE_CASES: readonly ISignatureCase[] = [
  { name: 'sha1WithRSA', b64: FLOOR_CA_CERT_B64, oid: '1.2.840.113549.1.1.5', pssHashOid: '' },
  { name: 'sha256WithRSA', b64: FLOOR_GOOD_CERT_B64, oid: '1.2.840.113549.1.1.11', pssHashOid: '' },
  {
    name: 'sha1WithRSA leaf',
    b64: FLOOR_SHA1_CERT_B64,
    oid: '1.2.840.113549.1.1.5',
    pssHashOid: '',
  },
  {
    name: 'RSASSA-PSS with SHA-256',
    b64: FLOOR_PSS_SHA256_CERT_B64,
    oid: '1.2.840.113549.1.1.10',
    pssHashOid: '2.16.840.1.101.3.4.2.1',
  },
  {
    name: 'RSASSA-PSS with the SHA-1 default',
    b64: FLOOR_PSS_SHA1_CERT_B64,
    oid: '1.2.840.113549.1.1.10',
    pssHashOid: '',
  },
  { name: 'Ed25519', b64: FLOOR_ED25519_CERT_B64, oid: '1.3.101.112', pssHashOid: '' },
  {
    name: 'ecdsa-with-SHA256',
    b64: FLOOR_ECDSA_CERT_B64,
    oid: '1.2.840.10045.4.3.2',
    pssHashOid: '',
  },
];

describe('DerSignatureAlgorithm.readSignatureAlgorithm', () => {
  it.each(SIGNATURE_CASES)('reads $name', ({ b64, oid, pssHashOid }) => {
    const der = derOf(b64);
    const algorithm = readSignatureAlgorithm(der);
    expect(algorithm).toEqual({ oid, pssHashOid });
  });

  it.each([
    { name: 'empty input', bytes: [] },
    { name: 'a SET where the certificate SEQUENCE belongs', bytes: [0x31, 0x00] },
    { name: 'an indefinite length', bytes: [0x30, 0x80, 0x00, 0x00] },
    { name: 'a five-byte length', bytes: [0x30, 0x85, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00] },
    { name: 'an empty certificate SEQUENCE', bytes: [0x30, 0x00] },
  ])('reports nothing for $name', ({ bytes }) => {
    const der = Buffer.from(bytes);
    const algorithm = readSignatureAlgorithm(der);
    expect(algorithm).toEqual(UNREADABLE);
  });

  it('reports nothing, and never throws, for every truncation of a real certificate', () => {
    const der = derOf(FLOOR_PSS_SHA256_CERT_B64);
    const lengths = Array.from({ length: der.length }, (_, index) => index);
    const results = lengths.map(length => {
      const prefix = der.subarray(0, length);
      return readSignatureAlgorithm(prefix);
    });
    const readable = results.filter(result => result.oid !== '' || result.pssHashOid !== '');
    expect(readable).toEqual([]);
  });
});
