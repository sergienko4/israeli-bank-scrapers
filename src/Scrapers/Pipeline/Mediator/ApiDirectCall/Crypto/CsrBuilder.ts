/**
 * CsrBuilder — a PKCS#10 v0 certificate request (N25b): the subject, the
 * signing key's SPKI and an empty attribute set `[0]`, signed SHA1withRSA
 * (1.2.840.113549.1.1.5), the algorithm device-registration protocols name.
 * The request is returned as base64url DER without padding.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { createPrivateKey, createPublicKey, type KeyObject, sign } from 'node:crypto';

import { csrSubjectDer, type ICsrSubjectValue } from './CsrSubject.js';
import { DER_TAGS, derNode, derSequence } from './DerEncoding.js';

/** AlgorithmIdentifier sha1WithRSAEncryption with NULL parameters. */
const SHA1_WITH_RSA = Buffer.from('300d06092a864886f70d0101050500', 'hex');

/** CertificationRequestInfo version 0. */
const VERSION_ZERO = Buffer.from('020100', 'hex');

/** An empty attribute set `[0]`. */
const NO_ATTRIBUTES = Buffer.of(DER_TAGS.contextZero, 0);

/** BIT STRING lead octet: no unused bits. */
const NO_UNUSED_BITS = Buffer.of(0);

/** The signing key and the hydrated subject. */
interface ICsrBuildInput {
  /** PKCS#8 PEM private key. */
  readonly keyPem: string;
  readonly subject: readonly ICsrSubjectValue[];
}

/**
 * Read a PEM private key without throwing.
 * @param pem - PKCS#8 PEM text.
 * @returns The key, or false when the text is not a private key.
 */
function tryPrivateKey(pem: string): KeyObject | false {
  try {
    return createPrivateKey(pem);
  } catch {
    return false;
  }
}

/**
 * The CertificationRequestInfo.
 * @param subject - Subject Name DER.
 * @param privateKey - Signing key.
 * @returns Request info DER.
 */
function requestInfo(subject: Buffer, privateKey: KeyObject): Buffer {
  const publicKey = createPublicKey(privateKey);
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return derSequence([VERSION_ZERO, subject, spki, NO_ATTRIBUTES]);
}

/**
 * Sign the request info and wrap it as a CertificationRequest.
 * @param info - Request info DER.
 * @param privateKey - RSA signing key.
 * @returns CertificationRequest DER.
 */
function signRequest(info: Buffer, privateKey: KeyObject): Buffer {
  const signature = sign('sha1', info, privateKey);
  const bits = Buffer.concat([NO_UNUSED_BITS, signature]);
  const bitString = derNode(DER_TAGS.bitString, bits);
  return derSequence([info, SHA1_WITH_RSA, bitString]);
}

/**
 * Build a signed PKCS#10 request.
 * @param input - Key PEM and subject.
 * @returns base64url DER, or false for a key that is not an RSA private key or a
 * subject it cannot encode.
 */
function buildCsr(input: ICsrBuildInput): string | false {
  const privateKey = tryPrivateKey(input.keyPem);
  if (privateKey === false || privateKey.asymmetricKeyType !== 'rsa') return false;
  const subject = csrSubjectDer(input.subject);
  if (subject === false) return false;
  const info = requestInfo(subject, privateKey);
  const request = signRequest(info, privateKey);
  return request.toString('base64url');
}

export type { ICsrBuildInput };
export { buildCsr };
