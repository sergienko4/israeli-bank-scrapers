/**
 * Named TLS ClientHello profiles the node:https transport can present.
 *
 * Some bank edges fingerprint the TLS handshake and admit only the bank's own
 * mobile client. The OneZero Cloudflare WAF, for example, rejects a request
 * that carries the right client certificate and User-Agent but arrives with
 * Node's stock ClientHello. A profile pins the cipher order, signature
 * algorithms, key-exchange groups, ALPN and OpenSSL option bits so Node emits
 * the target fingerprint. Each entry records the JA4 it must produce and the
 * lowest OpenSSL that can produce it; the JA4 oracle test pins both. Adding a
 * fingerprint is one map entry, so no transport code changes (OCP).
 */

import { constants as cryptoConstants } from 'node:crypto';
import type { ConnectionOptions } from 'node:tls';

import { getDebug } from '../../../Logging/Debug.js';

/** Module logger — name derived from source filename per project convention. */
const LOG = getDebug(import.meta.url);

/** WARN text when the runtime cannot emit a profile's fingerprint. */
const UNSUPPORTED_MSG =
  '[tls] runtime OpenSSL cannot emit this TLS profile; the bank edge may block requests';

/** Registered profile names. `node-default` keeps Node's stock handshake. */
type TlsClientProfileKind = 'node-default' | 'android-11-okhttp';

/** The handshake-shaping subset of `tls.ConnectionOptions` a profile may set. */
type TlsProfileOptions = Pick<
  ConnectionOptions,
  | 'ALPNProtocols'
  | 'ciphers'
  | 'ecdhCurve'
  | 'maxVersion'
  | 'minVersion'
  | 'requestOCSP'
  | 'secureOptions'
  | 'sigalgs'
>;

/** OpenSSL `major.minor` pair. */
type OpenSslVersion = readonly [major: number, minor: number];

/** One registered ClientHello profile. */
interface ITlsClientProfile {
  /** Handshake options merged into the transport agent. */
  readonly options: Readonly<TlsProfileOptions>;
  /** JA4 emitted on a supported runtime; empty when the profile pins none. */
  readonly expectedJa4: string;
  /** Lowest OpenSSL that emits `expectedJa4`. */
  readonly minOpenSsl: OpenSslVersion;
}

/**
 * OpenSSL `SSL_OP_TLSEXT_PADDING` (bit 4). Node does not export it by name. It
 * adds the padding extension (0x0015) that the Android client sends.
 */
const SSL_OP_TLSEXT_PADDING = 0x10;

/**
 * Cipher order of the Android 11 OkHttp/Conscrypt client. `@SECLEVEL=0` keeps
 * OpenSSL from dropping `rsa_pkcs1_sha1` from the offered signature algorithms;
 * without it the JA4 signature-algorithm hash no longer matches.
 */
const ANDROID_11_CIPHERS = [
  '@SECLEVEL=0',
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':');

/** Signature-algorithm order of the Android 11 OkHttp/Conscrypt client. */
const ANDROID_11_SIGALGS = [
  'ecdsa_secp256r1_sha256',
  'rsa_pss_rsae_sha256',
  'rsa_pkcs1_sha256',
  'ecdsa_secp384r1_sha384',
  'rsa_pss_rsae_sha384',
  'rsa_pkcs1_sha384',
  'rsa_pss_rsae_sha512',
  'rsa_pkcs1_sha512',
  'rsa_pkcs1_sha1',
].join(':');

/**
 * Android 11 OkHttp/Conscrypt ClientHello. OpenSSL 3.0 cannot reproduce it: it
 * adds the renegotiation SCSV cipher and omits the renegotiation_info
 * extension, so the profile needs OpenSSL 3.5 or newer.
 */
const ANDROID_11_OKHTTP: ITlsClientProfile = {
  options: {
    ciphers: ANDROID_11_CIPHERS,
    sigalgs: ANDROID_11_SIGALGS,
    ecdhCurve: 'X25519:P-256:P-384',
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
    ALPNProtocols: ['http/1.1'],
    requestOCSP: true,
    secureOptions: SSL_OP_TLSEXT_PADDING | cryptoConstants.SSL_OP_NO_ENCRYPT_THEN_MAC,
  },
  expectedJa4: 't13d1513h1_8daaf6152771_eca864cca44a',
  minOpenSsl: [3, 5],
};

/** Registry of every ClientHello profile, keyed by kind. */
const TLS_CLIENT_PROFILES: Readonly<Record<TlsClientProfileKind, ITlsClientProfile>> = {
  'node-default': { options: {}, expectedJa4: '', minOpenSsl: [0, 0] },
  'android-11-okhttp': ANDROID_11_OKHTTP,
};

/** Leading `major.minor` of an OpenSSL version string such as `3.5.9+quic`. */
const OPENSSL_VERSION_PATTERN = /^(?<major>\d+)\.(?<minor>\d+)/;

/** Weight that orders `major` ahead of `minor` in a single comparable score. */
const MAJOR_WEIGHT = 1000;

/** Version assumed for unparsable text: meets only a profile with no floor. */
const UNKNOWN_OPENSSL = { major: '0', minor: '0' };

/**
 * Scores an OpenSSL version string so versions compare as numbers.
 * @param version - OpenSSL version text, e.g. `process.versions.openssl`.
 * @returns Comparable score; 0 when the text has no `major.minor` prefix.
 */
function scoreOpenSsl(version: string): number {
  const groups = OPENSSL_VERSION_PATTERN.exec(version)?.groups ?? UNKNOWN_OPENSSL;
  return Number(groups.major) * MAJOR_WEIGHT + Number(groups.minor);
}

/**
 * Looks up a registered ClientHello profile.
 * @param kind - Registered profile name.
 * @returns The profile's options, pinned JA4 and OpenSSL floor.
 */
function getTlsClientProfile(kind: TlsClientProfileKind): ITlsClientProfile {
  return TLS_CLIENT_PROFILES[kind];
}

/**
 * Reports whether a runtime's OpenSSL can emit a profile's fingerprint.
 * Unparsable version text fails every profile with an OpenSSL floor, so
 * callers warn rather than assume the handshake matches; `node-default` has
 * no floor and is always supported.
 * @param kind - Registered profile name.
 * @param openssl - Runtime OpenSSL version, e.g. `process.versions.openssl`.
 * @returns True when the runtime meets the profile's OpenSSL floor.
 */
function isTlsProfileSupported(kind: TlsClientProfileKind, openssl: string): boolean {
  const [major, minor] = TLS_CLIENT_PROFILES[kind].minOpenSsl;
  return scoreOpenSsl(openssl) >= major * MAJOR_WEIGHT + minor;
}

/**
 * Formats a profile's OpenSSL floor for diagnostics.
 * @param kind - Registered profile name.
 * @returns The floor as `major.minor`, e.g. `3.5`.
 */
function minOpenSslLabel(kind: TlsClientProfileKind): string {
  return TLS_CLIENT_PROFILES[kind].minOpenSsl.join('.');
}

/**
 * Warns when the runtime cannot emit a profile's fingerprint. Requests still
 * proceed, because the bank edge decides; a block then surfaces as WAF_BLOCKED.
 * @param kind - Registered profile name.
 * @param openssl - Runtime OpenSSL version, e.g. `process.versions.openssl`.
 * @returns True when a warning was emitted.
 */
function warnIfTlsProfileUnsupported(kind: TlsClientProfileKind, openssl: string): boolean {
  if (isTlsProfileSupported(kind, openssl)) return false;
  const minimum = minOpenSslLabel(kind);
  LOG.warn({ tlsProfile: kind, openssl, minimum, message: UNSUPPORTED_MSG });
  return true;
}

export type { ITlsClientProfile, TlsClientProfileKind, TlsProfileOptions };
export { getTlsClientProfile, isTlsProfileSupported, warnIfTlsProfileUnsupported };
