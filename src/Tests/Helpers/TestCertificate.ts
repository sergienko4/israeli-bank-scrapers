/**
 * Test X.509 builder — issues an RSA certificate (X.509 v1,
 * sha256WithRSAEncryption) over a fresh or given key with a chosen validity
 * window, so client-certificate suites present real certificates without any
 * committed key material. Self-signed by default; a mocked bank can instead
 * certify a request's public key under its own issuing key.
 * Test-only: production never issues certificates.
 */

import { createHash, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';

import {
  DER_TAGS,
  derNode,
  derSequence,
} from '../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/DerEncoding.js';

/** AlgorithmIdentifier sha256WithRSAEncryption with NULL parameters. */
const SHA256_WITH_RSA = Buffer.from('300d06092a864886f70d01010b0500', 'hex');

/** INTEGER 1, the serial every test certificate carries. */
const SERIAL_ONE = Buffer.from('020101', 'hex');

/** OBJECT IDENTIFIER 2.5.4.3 (commonName). */
const COMMON_NAME_OID = Buffer.from('0603550403', 'hex');

/** UTCTime tag; its 13-octet body always fits the short length form. */
const UTC_TIME_TAG = 0x17;

/** Default validity window, inside the UTCTime range (1950–2049). */
const DEFAULT_NOT_BEFORE = '2020-01-01T00:00:00.000Z';
const DEFAULT_NOT_AFTER = '2049-12-31T00:00:00.000Z';

/** PEM base64 line width. */
const PEM_LINE = /.{1,64}/g;

/** What a test certificate is issued for. */
interface ITestCertOptions {
  readonly commonName?: string;
  /** ISO instant the certificate becomes valid. */
  readonly notBefore?: string;
  /** ISO instant the certificate expires. */
  readonly notAfter?: string;
  /** PKCS#8 PEM to certify; a fresh RSA-2048 key when absent. */
  readonly keyPem?: string;
  /** Public key PEM to certify instead; `keyPem` then signs as the issuer. */
  readonly subjectKeyPem?: string;
}

/** An issued test certificate, its key and the SHA-256 of its DER. */
interface ITestCert {
  readonly keyPem: string;
  readonly certPem: string;
  readonly sha256: string;
}

/**
 * A UTCTime node for an ISO instant.
 * @param iso - ISO instant (years 1950–2049).
 * @returns The DER UTCTime node.
 */
function utcTime(iso: string): Buffer {
  const digits = iso.slice(2, 19).replaceAll(/[-:T]/g, '');
  const text = Buffer.from(`${digits}Z`, 'ascii');
  const head = Buffer.of(UTC_TIME_TAG, text.length);
  return Buffer.concat([head, text]);
}

/**
 * A Name holding one commonName.
 * @param commonName - The CN text.
 * @returns The DER Name.
 */
function nameOf(commonName: string): Buffer {
  const text = Buffer.from(commonName, 'utf8');
  const value = derNode(DER_TAGS.utf8String, text);
  const attribute = derSequence([COMMON_NAME_OID, value]);
  const rdn = derNode(DER_TAGS.set, attribute);
  return derSequence([rdn]);
}

/**
 * A fresh RSA-2048 private key.
 * @returns PKCS#8 PEM.
 */
function freshKeyPem(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}

/**
 * The to-be-signed part of a self-signed certificate.
 * @param options - Issue options.
 * @param keyPem - The certified key, unless the options name a subject key.
 * @returns The DER TBSCertificate.
 */
function tbsOf(options: ITestCertOptions, keyPem: string): Buffer {
  const name = nameOf(options.commonName ?? 'test-device');
  const notBefore = utcTime(options.notBefore ?? DEFAULT_NOT_BEFORE);
  const notAfter = utcTime(options.notAfter ?? DEFAULT_NOT_AFTER);
  const validity = derSequence([notBefore, notAfter]);
  const subjectKey = createPublicKey(options.subjectKeyPem ?? keyPem);
  const spki = subjectKey.export({ type: 'spki', format: 'der' });
  return derSequence([SERIAL_ONE, SHA256_WITH_RSA, name, validity, name, spki]);
}

/**
 * Wrap DER as a PEM certificate.
 * @param der - Certificate DER.
 * @returns PEM text.
 */
function toPem(der: Buffer): string {
  const lines = der.toString('base64').match(PEM_LINE) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/**
 * Issue a test certificate, self-signed unless the options name a subject key.
 * @param options - Common name, validity window, optional key and subject key.
 * @returns The key, the certificate and the SHA-256 hex of its DER.
 */
function issueTestCert(options: ITestCertOptions = {}): ITestCert {
  const keyPem = options.keyPem ?? freshKeyPem();
  const tbs = tbsOf(options, keyPem);
  const signature = sign('sha256', tbs, keyPem);
  const unusedBits = Buffer.of(0);
  const bitsBody = Buffer.concat([unusedBits, signature]);
  const bits = derNode(DER_TAGS.bitString, bitsBody);
  const der = derSequence([tbs, SHA256_WITH_RSA, bits]);
  const sha256 = createHash('sha256').update(der).digest('hex');
  return { keyPem, certPem: toPem(der), sha256 };
}

export type { ITestCert, ITestCertOptions };
export { issueTestCert };
