/**
 * Server-certificate security floor for the node:https transport.
 *
 * A TLS profile may lower OpenSSL's security level to reproduce a mobile
 * client's handshake — the Android profile sets `@SECLEVEL=0` so OpenSSL keeps
 * `rsa_pkcs1_sha1` in the offered signature algorithms. OpenSSL applies that
 * same level to certificate verification, so on its own it would also accept a
 * server chain with a 1024-bit key or a SHA-1 signature. This floor restores
 * those checks, matching OpenSSL security level 2 (112-bit), whatever level the
 * profile sets. It runs as the agent's `checkServerIdentity`, which Node calls
 * after chain verification and before any request data is written, so a weak
 * chain fails the connection without sending a byte of the request.
 */

import { type KeyObject, X509Certificate } from 'node:crypto';
import { checkServerIdentity, type PeerCertificate } from 'node:tls';

import { type ISignatureAlgorithm, readSignatureAlgorithm } from './DerSignatureAlgorithm.js';

/** Failure reason; names no host or certificate field, so it is log-safe. */
const SERVER_CERT_FLOOR_REASON =
  'server certificate chain is below the TLS security floor (weak key or signature)';

/** One link of the peer chain Node passes to `checkServerIdentity`. */
interface IChainLink {
  readonly raw: Buffer;
  /** The issuer's link; the link itself for a self-signed anchor. */
  readonly issuerCertificate?: IChainLink;
}

/** Whether one public key meets the floor. */
type KeyFloor = (key: KeyObject) => boolean;

/** Smallest RSA / DSA modulus at 112-bit security. */
const MIN_MODULUS_BITS = 2048;

/** Named curves whose order is at least 224 bits. */
const STRONG_CURVES: ReadonlySet<string> = new Set([
  'secp224r1',
  'prime256v1',
  'secp384r1',
  'secp521r1',
]);

/** Signature algorithms at 112-bit security or better, by dotted OID. */
const STRONG_SIGNATURE_OIDS: ReadonlySet<string> = new Set([
  '1.2.840.113549.1.1.11', // sha256WithRSAEncryption
  '1.2.840.113549.1.1.12', // sha384WithRSAEncryption
  '1.2.840.113549.1.1.13', // sha512WithRSAEncryption
  '1.2.840.113549.1.1.14', // sha224WithRSAEncryption
  '1.2.840.10045.4.3.1', // ecdsa-with-SHA224
  '1.2.840.10045.4.3.2', // ecdsa-with-SHA256
  '1.2.840.10045.4.3.3', // ecdsa-with-SHA384
  '1.2.840.10045.4.3.4', // ecdsa-with-SHA512
  '1.3.101.112', // Ed25519
  '1.3.101.113', // Ed448
]);

/** RSASSA-PSS; its strength is that of the hash named in its parameters. */
const RSASSA_PSS_OID = '1.2.840.113549.1.1.10';

/** SHA-2 hashes a PSS signature may name. */
const STRONG_PSS_HASH_OIDS: ReadonlySet<string> = new Set([
  '2.16.840.1.101.3.4.2.1', // sha256
  '2.16.840.1.101.3.4.2.2', // sha384
  '2.16.840.1.101.3.4.2.3', // sha512
  '2.16.840.1.101.3.4.2.4', // sha224
]);

/**
 * RSA-family key floor.
 * @param key - Public key.
 * @returns True when the modulus is at least 2048 bits.
 */
function hasStrongModulus(key: KeyObject): boolean {
  const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
  return bits >= MIN_MODULUS_BITS;
}

/**
 * EC key floor.
 * @param key - Public key.
 * @returns True when the named curve is at least 224 bits.
 */
function hasStrongCurve(key: KeyObject): boolean {
  const curve = key.asymmetricKeyDetails?.namedCurve ?? '';
  return STRONG_CURVES.has(curve);
}

/**
 * EdDSA keys have fixed strength above the floor.
 * @returns Always true.
 */
function isFixedStrength(): boolean {
  return true;
}

/** Key floor per key type. An unlisted type fails closed. */
const KEY_FLOORS: Readonly<Partial<Record<string, KeyFloor>>> = {
  rsa: hasStrongModulus,
  'rsa-pss': hasStrongModulus,
  dsa: hasStrongModulus,
  ec: hasStrongCurve,
  ed25519: isFixedStrength,
  ed448: isFixedStrength,
};

/**
 * Whether a public key meets the floor.
 * @param key - Public key.
 * @returns True when its type is known and its size is sufficient.
 */
function isStrongKey(key: KeyObject): boolean {
  const floor = KEY_FLOORS[key.asymmetricKeyType ?? ''];
  if (floor === undefined) return false;
  return floor(key);
}

/**
 * Whether a signature algorithm meets the floor.
 * @param algorithm - The certificate's outer signature algorithm.
 * @returns True for SHA-2 or EdDSA signatures.
 */
function isStrongSignature(algorithm: ISignatureAlgorithm): boolean {
  if (algorithm.oid === RSASSA_PSS_OID) return STRONG_PSS_HASH_OIDS.has(algorithm.pssHashOid);
  return STRONG_SIGNATURE_OIDS.has(algorithm.oid);
}

/**
 * Whether one chain link meets the floor. Every key is checked; a self-signed
 * anchor's own signature is not, because it carries no trust — the same
 * exemption OpenSSL gives the trust anchor.
 * @param link - Chain link.
 * @returns True when the link's key and signature are strong enough.
 */
function isLinkAboveFloor(link: IChainLink): boolean {
  const { publicKey } = new X509Certificate(link.raw);
  if (!isStrongKey(publicKey)) return false;
  if (link.issuerCertificate === link) return true;
  const algorithm = readSignatureAlgorithm(link.raw);
  return isStrongSignature(algorithm);
}

/**
 * Collect the chain from the leaf, stopping at a missing or repeated issuer.
 * @param link - Current link.
 * @param seen - Links collected before it.
 * @returns The chain, leaf first.
 */
function collectChain(link: IChainLink, seen: readonly IChainLink[]): readonly IChainLink[] {
  const chain = [...seen, link];
  const issuer = link.issuerCertificate;
  if (issuer === undefined || chain.includes(issuer)) return chain;
  return collectChain(issuer, chain);
}

/**
 * Whether every certificate in the server chain meets the floor.
 * @param leaf - The server certificate with its issuer links.
 * @returns True when the whole chain passes; false on any weak or unreadable link.
 */
function isServerChainAboveFloor(leaf: IChainLink): boolean {
  try {
    const chain = collectChain(leaf, []);
    return chain.every(isLinkAboveFloor);
  } catch {
    return false;
  }
}

/**
 * `checkServerIdentity` for the node:https transport: the standard hostname
 * check, then the chain floor.
 * @param host - Host the client connected to.
 * @param cert - Peer certificate with its issuer chain.
 * @returns The hostname error, the floor error, or Node's "accept" value.
 */
function checkServerCertificate(
  host: string,
  cert: PeerCertificate,
): ReturnType<typeof checkServerIdentity> {
  const identityError = checkServerIdentity(host, cert);
  if (identityError !== undefined || isServerChainAboveFloor(cert)) return identityError;
  return new Error(SERVER_CERT_FLOOR_REASON);
}

export type { IChainLink };
export { checkServerCertificate, isServerChainAboveFloor, SERVER_CERT_FLOOR_REASON };
