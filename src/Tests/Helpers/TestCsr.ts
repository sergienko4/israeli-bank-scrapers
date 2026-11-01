/**
 * Test-side PKCS#10 reader — splits a base64url certification request into its
 * DER nodes and checks its self-signature, so suites can read back what the
 * `pkcs10-csr` generator sent without trusting the builder that wrote it.
 * Definite lengths only. Test-only: production never parses requests.
 */

import { createPublicKey, type KeyObject, verify } from 'node:crypto';

/** One DER node read back from a request. */
interface ITlv {
  readonly tag: number;
  readonly whole: Buffer;
  readonly body: Buffer;
}

/** A request's subject and key, read back once its signature holds. */
interface ITestCsr {
  readonly subject: Buffer;
  readonly publicKey: KeyObject;
}

/** OpenSSL's name for the SHA1withRSA signature the generator writes. */
const CSR_SIGNATURE = 'RSA-SHA1';

/**
 * Read the DER node at `offset`.
 * @param der - DER bytes.
 * @param offset - Node start.
 * @returns Tag, whole node and body.
 */
function readTlv(der: Buffer, offset: number): ITlv {
  const first = der[offset + 1];
  const lengthBytes = first < 0x80 ? 0 : first - 0x80;
  const length = lengthBytes === 0 ? first : der.readUIntBE(offset + 2, lengthBytes);
  const start = offset + 2 + lengthBytes;
  const whole = der.subarray(offset, start + length);
  const body = der.subarray(start, start + length);
  return { tag: der[offset], whole, body };
}

/**
 * The child nodes of a constructed node's body.
 * @param body - Constructed node body.
 * @param offset - Next child.
 * @returns Children in order.
 */
function childrenOf(body: Buffer, offset = 0): readonly ITlv[] {
  if (offset >= body.length) return [];
  const head = readTlv(body, offset);
  const rest = childrenOf(body, offset + head.whole.length);
  return [head, ...rest];
}

/**
 * Split a base64url request into request info, algorithm and signature.
 * @param csr - base64url DER.
 * @returns The three top-level nodes; none when the outer node is not the whole input.
 */
function csrPartsOf(csr: string): readonly ITlv[] {
  const der = Buffer.from(csr, 'base64url');
  const outer = readTlv(der, 0);
  if (outer.whole.length !== der.length) return [];
  return childrenOf(outer.body);
}

/**
 * Whether the request info is signed by the key it names.
 * @param info - CertificationRequestInfo node.
 * @param signature - Signature BIT STRING node.
 * @param publicKey - The key the request info names.
 * @returns True when the signature verifies.
 */
function isSelfSigned(info: ITlv, signature: ITlv, publicKey: KeyObject): boolean {
  const signed = signature.body.subarray(1);
  return verify(CSR_SIGNATURE, info.whole, publicKey, signed);
}

/**
 * Read a request back: its subject and key, once its self-signature holds.
 * @param csr - base64url DER.
 * @returns The subject and key, or false for a malformed or forged request.
 */
function openTestCsr(csr: string): ITestCsr | false {
  try {
    const [info, , signature] = csrPartsOf(csr);
    const [, subject, spki] = childrenOf(info.body);
    const publicKey = createPublicKey({ key: spki.whole, format: 'der', type: 'spki' });
    return isSelfSigned(info, signature, publicKey) && { subject: subject.whole, publicKey };
  } catch {
    return false;
  }
}

export type { ITestCsr, ITlv };
export { childrenOf, csrPartsOf, openTestCsr, readTlv };
