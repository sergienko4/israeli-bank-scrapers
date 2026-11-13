/**
 * CsrBuilder — a PKCS#10 v0 certificate request: the subject, the signing
 * key's SPKI and a `[0]` attribute set carrying an optional extensionRequest.
 * The default profile signs SHA1withRSA (1.2.840.113549.1.1.5) and returns
 * base64url DER, the algorithm and wire form device-registration protocols
 * name. Two optional knobs express other profiles without forking the builder:
 * SHA-256 signing, and a PEM-then-Base64 wire form for a request the peer
 * double-encodes.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import { createPrivateKey, createPublicKey, type KeyObject, sign } from 'node:crypto';

import { csrSubjectDer, type ICsrSubjectValue } from './CsrSubject.js';
import { DER_TAGS, derNode, derOid, derSequence } from './DerEncoding.js';

/** AlgorithmIdentifier sha1WithRSAEncryption with NULL parameters. */
const SHA1_WITH_RSA = Buffer.from('300d06092a864886f70d0101050500', 'hex');

/** AlgorithmIdentifier sha256WithRSAEncryption with NULL parameters. */
const SHA256_WITH_RSA = Buffer.from('300d06092a864886f70d01010b0500', 'hex');

/** CertificationRequestInfo version 0. */
const VERSION_ZERO = Buffer.from('020100', 'hex');

/** An empty attribute set `[0]`. */
const NO_ATTRIBUTES = Buffer.of(DER_TAGS.contextZero, 0);

/** BIT STRING lead octet: no unused bits. */
const NO_UNUSED_BITS = Buffer.of(0);

/** PKCS#9 extensionRequest, the attribute that carries X.509 extensions. */
const EXTENSION_REQUEST_OID = '1.2.840.113549.1.9.14';

/** DER BOOLEAN TRUE: one content octet, 0xFF. */
const BOOLEAN_TRUE = Buffer.of(0x01, 0x01, 0xff);

/** PEM line width, matching BouncyCastle's writer. */
const PEM_LINE_CHARS = 64;

/** Header and footer of a PEM certificate request. */
const PEM_HEADER = '-----BEGIN CERTIFICATE REQUEST-----';
const PEM_FOOTER = '-----END CERTIFICATE REQUEST-----';

/** Signature algorithms the builder can produce. */
type CsrSignatureAlgorithm = 'sha1' | 'sha256';

/** Wire form: base64url DER (default), or Base64 of the PEM text. */
type CsrWireForm = 'base64url-der' | 'base64-pem';

/**
 * One X.509 extension for the request.
 *
 * <p>`valueHex` is the DER of the extension's `extnValue` body, not of the
 * enclosing octet string: for basicConstraints `cA=TRUE` it is `30030101ff`.
 */
interface ICsrExtension {
  /** Dotted extension OID, e.g. `2.5.29.19`. */
  readonly oid: string;
  /** Emit the critical BOOLEAN TRUE when set; omitted when false. */
  readonly critical: boolean;
  /** Hex of the DER value the extension carries. */
  readonly valueHex: string;
}

/** The signing key, the hydrated subject and the optional profile. */
interface ICsrBuildInput {
  /** PKCS#8 PEM private key. */
  readonly keyPem: string;
  readonly subject: readonly ICsrSubjectValue[];
  /** Signature algorithm; SHA-1 when absent, for backward compatibility. */
  readonly signature?: CsrSignatureAlgorithm;
  /** X.509 extensions to request, in order; none when absent. */
  readonly extensions?: readonly ICsrExtension[];
  /** Wire form; base64url DER when absent. */
  readonly wireForm?: CsrWireForm;
}

/** AlgorithmIdentifier and nodejs digest name per signature algorithm. */
const SIGNATURE_PROFILES: Readonly<
  Record<CsrSignatureAlgorithm, { readonly algorithm: Buffer; readonly digest: string }>
> = {
  sha1: { algorithm: SHA1_WITH_RSA, digest: 'sha1' },
  sha256: { algorithm: SHA256_WITH_RSA, digest: 'sha256' },
};

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
 * One Extension node: SEQUENCE { extnID, critical?, extnValue }.
 * @param extension - Extension config.
 * @returns The node, or false for a malformed OID or value.
 */
function extensionDer(extension: ICsrExtension): Buffer | false {
  const oid = derOid(extension.oid);
  if (oid === false) return false;
  if (!/^(?:[0-9a-f]{2})*$/i.test(extension.valueHex)) return false;
  const valueBytes = Buffer.from(extension.valueHex, 'hex');
  const value = derNode(DER_TAGS.octetString, valueBytes);
  const parts = extension.critical ? [oid, BOOLEAN_TRUE, value] : [oid, value];
  return derSequence(parts);
}

/**
 * Encode every extension, or refuse the first malformed one.
 * @param extensions - Requested extensions.
 * @returns Encoded nodes, or false.
 */
function extensionNodes(extensions: readonly ICsrExtension[]): readonly Buffer[] | false {
  const encoded = extensions.map(extensionDer);
  if (encoded.includes(false)) return false;
  return encoded.filter((extension): extension is Buffer => extension !== false);
}

/**
 * The `[0]` attributes set: an extensionRequest attribute when extensions are
 * given, else the empty set.
 * @param extensions - Requested extensions.
 * @returns Attributes node, or false when an extension cannot be encoded.
 */
function attributesDer(extensions: readonly ICsrExtension[]): Buffer | false {
  if (extensions.length === 0) return NO_ATTRIBUTES;
  const nodes = extensionNodes(extensions);
  if (nodes === false) return false;
  return extensionRequestDer(nodes);
}

/**
 * Wrap encoded extensions as the PKCS#9 extensionRequest attribute inside the
 * `[0]` set.
 * @param nodes - Encoded Extension nodes.
 * @returns Attributes node, or false for a malformed OID.
 */
function extensionRequestDer(nodes: readonly Buffer[]): Buffer | false {
  const oid = derOid(EXTENSION_REQUEST_OID);
  if (oid === false) return false;
  const extensionsNode = derSequence(nodes);
  const values = derNode(DER_TAGS.set, extensionsNode);
  const attribute = derSequence([oid, values]);
  return derNode(DER_TAGS.contextZero, attribute);
}

/**
 * The CertificationRequestInfo.
 * @param subject - Subject Name DER.
 * @param privateKey - Signing key.
 * @param attributes - `[0]` attributes node.
 * @returns Request info DER.
 */
function requestInfo(subject: Buffer, privateKey: KeyObject, attributes: Buffer): Buffer {
  const publicKey = createPublicKey(privateKey);
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return derSequence([VERSION_ZERO, subject, spki, attributes]);
}

/**
 * Sign the request info and wrap it as a CertificationRequest.
 * @param info - Request info DER.
 * @param privateKey - RSA signing key.
 * @param profile - Signature algorithm.
 * @param profile.algorithm - AlgorithmIdentifier DER.
 * @param profile.digest - Node digest name.
 * @returns CertificationRequest DER.
 */
function signRequest(
  info: Buffer,
  privateKey: KeyObject,
  profile: { readonly algorithm: Buffer; readonly digest: string },
): Buffer {
  const signature = sign(profile.digest, info, privateKey);
  const bits = Buffer.concat([NO_UNUSED_BITS, signature]);
  const bitString = derNode(DER_TAGS.bitString, bits);
  return derSequence([info, profile.algorithm, bitString]);
}

/**
 * Wrap DER in the PEM a certificate request uses, BouncyCastle style: 64-char
 * lines and a trailing newline.
 * @param der - Request DER.
 * @returns PEM text.
 */
function pemOf(der: Buffer): string {
  const body = der.toString('base64');
  const pattern = `.{1,${String(PEM_LINE_CHARS)}}`;
  const lines = body.match(new RegExp(pattern, 'g')) ?? [];
  return `${PEM_HEADER}\n${lines.join('\n')}\n${PEM_FOOTER}\n`;
}

/**
 * Render the request in the requested wire form.
 * @param request - Request DER.
 * @param wireForm - Wire form.
 * @returns Encoded request text.
 */
function encodeRequest(request: Buffer, wireForm: CsrWireForm): string {
  if (wireForm === 'base64-pem') {
    const pem = pemOf(request);
    const bytes = Buffer.from(pem, 'utf8');
    return bytes.toString('base64');
  }
  return request.toString('base64url');
}

/**
 * Build a signed PKCS#10 request.
 * @param input - Key PEM, subject and optional profile.
 * @returns The request in the requested wire form, or false for a key that is
 * not an RSA private key, a subject it cannot encode, or a malformed extension.
 */
function buildCsr(input: ICsrBuildInput): string | false {
  const privateKey = tryPrivateKey(input.keyPem);
  if (privateKey === false || privateKey.asymmetricKeyType !== 'rsa') return false;
  const subject = csrSubjectDer(input.subject);
  if (subject === false) return false;
  return requestFor(input, subject, privateKey);
}

/**
 * Assemble, sign and encode one request.
 * @param input - Key PEM, subject and optional profile.
 * @param subject - Encoded subject Name.
 * @param privateKey - RSA signing key.
 * @returns Encoded request, or false for a malformed extension.
 */
function requestFor(input: ICsrBuildInput, subject: Buffer, privateKey: KeyObject): string | false {
  const attributes = attributesDer(input.extensions ?? []);
  if (attributes === false) return false;
  const info = requestInfo(subject, privateKey, attributes);
  const profile = SIGNATURE_PROFILES[input.signature ?? 'sha1'];
  const request = signRequest(info, privateKey, profile);
  return encodeRequest(request, input.wireForm ?? 'base64url-der');
}

export type { CsrSignatureAlgorithm, CsrWireForm, ICsrBuildInput, ICsrExtension };
export { buildCsr };
