/**
 * GenericCryptoSigner — signs pre-built canonical bytes with a
 * configured algorithm/encoding and assembles the outbound header
 * value: `data:<b64>;key-id:<hex>;scheme:<schemeTag>`. Carries zero
 * bank knowledge.
 */

import { createSign } from 'node:crypto';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type {
  IAsymmetricSignerConfig,
  ISignerConfig,
  SignerEncoding,
} from '../IApiDirectCallConfig.js';
import { signAesCbcPkcs7 } from './AesSymmetricSigner.js';
import type { IGenericKeypair } from './CryptoKeyFactory.js';

/** Lookup table — Partial wrapper makes lookups safely undefined-able at runtime. */
const DSA_ENCODING_MAP: Readonly<Partial<Record<SignerEncoding, 'der' | 'ieee-p1363'>>> = {
  DER: 'der',
  JOSE: 'ieee-p1363',
};

/**
 * Map a SignerEncoding tag onto Node's `dsaEncoding` option used by
 * createSign.sign.
 * @param encoding - Tag from ISignerConfig.encoding.
 * @returns Node DSA encoding name, or fail when unsupported.
 */
function dsaEncodingFor(encoding: SignerEncoding): Procedure<'der' | 'ieee-p1363'> {
  const mapped = DSA_ENCODING_MAP[encoding];
  if (mapped === undefined) {
    return fail(ScraperErrorTypes.Generic, `unsupported signer encoding: ${encoding as string}`);
  }
  return succeed(mapped);
}

/**
 * Run SHA-256 sign over the canonical bytes with the configured
 * encoding, returning base64 of the signature.
 * @param bytes - Canonical bytes to sign.
 * @param keypair - IGenericKeypair carrying the private key.
 * @param encoding - DSA encoding tag from config.
 * @returns Procedure with base64 signature string.
 */
function signBytes(
  bytes: Buffer,
  keypair: IGenericKeypair,
  encoding: SignerEncoding,
): Procedure<string> {
  const dsaEnc = dsaEncodingFor(encoding);
  if (!dsaEnc.success) return dsaEnc;
  const signer = createSign('SHA256');
  signer.update(bytes);
  const sig = signer.sign({ key: keypair.privateKey, dsaEncoding: dsaEnc.value });
  const sigBase64 = sig.toString('base64');
  return succeed(sigBase64);
}

/**
 * Sign canonical bytes and assemble the full header value.
 *
 * Accepts only the asymmetric (ECDSA/RSA) variant; AES-CBC-PKCS7
 * signing is dispatched by {@link signCanonicalDispatch} into
 * AesSymmetricSigner because its output is body-attached, not
 * header-attached, and the canonical input shape differs (the AES
 * path receives a UTF-8 canonical STRING, not pre-built bytes).
 * @param bytes - Canonical bytes the caller already built (sortQuery,
 *   escape, etc. handled upstream).
 * @param keypair - IGenericKeypair carrying private key + key-id.
 * @param config - IAsymmetricSignerConfig (algorithm/encoding/headerName/schemeTag).
 * @returns Procedure with the assembled header value.
 */
function signCanonical(
  bytes: Buffer,
  keypair: IGenericKeypair,
  config: IAsymmetricSignerConfig,
): Procedure<string> {
  const sigB64 = signBytes(bytes, keypair, config.encoding);
  if (!sigB64.success) return sigB64;
  const schemeStr = String(config.schemeTag);
  const value = `data:${sigB64.value};key-id:${keypair.keyIdHex};scheme:${schemeStr}`;
  return succeed(value);
}

/**
 * Args bundle for {@link signCanonicalDispatch} — covers both the
 * asymmetric (header-attached) and the AES (body-attached) paths.
 *
 * For the asymmetric path: `keypair` MUST be present; `keyBytes` /
 * `ivBytes` are ignored.
 * For the AES path: `keyBytes` + `ivBytes` MUST be present; `keypair`
 * is ignored.
 *
 * The caller (RunStep) chooses which fields to populate based on the
 * signer config's algorithm discriminator.
 */
interface ISignDispatchArgs {
  readonly canonical: string;
  readonly canonicalBytes: Buffer;
  readonly config: ISignerConfig;
  readonly keypair?: IGenericKeypair;
  readonly keyBytes?: Buffer;
  readonly ivBytes?: Buffer;
}

/**
 * Dispatch the AES branch: validate keyBytes + ivBytes are present,
 * then hand off to AesSymmetricSigner.
 * @param args - Full dispatch args bundle.
 * @returns Procedure with base64 ciphertext + optional postfix.
 */
function dispatchAesBranch(args: ISignDispatchArgs): Procedure<string> {
  if (args.keyBytes === undefined || args.ivBytes === undefined) {
    return fail(ScraperErrorTypes.Generic, 'AES dispatch requires keyBytes and ivBytes');
  }
  if (args.config.algorithm !== 'AES-CBC-PKCS7') {
    return fail(ScraperErrorTypes.Generic, 'dispatchAesBranch called for non-AES algorithm');
  }
  return signAesCbcPkcs7({
    plaintext: args.canonical,
    keyBytes: args.keyBytes,
    ivBytes: args.ivBytes,
    outputPostfix: args.config.outputPostfix,
  });
}

/**
 * Dispatch the asymmetric (ECDSA/RSA) branch: validate keypair is
 * present, then hand off to {@link signCanonical}.
 * @param args - Full dispatch args bundle.
 * @returns Procedure with the assembled header value.
 */
function dispatchAsymmetricBranch(args: ISignDispatchArgs): Procedure<string> {
  if (args.keypair === undefined) {
    return fail(ScraperErrorTypes.Generic, 'asymmetric dispatch requires keypair');
  }
  if (args.config.algorithm === 'AES-CBC-PKCS7') {
    return fail(ScraperErrorTypes.Generic, 'dispatchAsymmetricBranch called for AES algorithm');
  }
  return signCanonical(args.canonicalBytes, args.keypair, args.config);
}

/**
 * Dispatch the configured algorithm to its signer implementation.
 *
 * Routes:
 *   - 'ECDSA-P256' / 'RSA-2048' → asymmetric {@link signCanonical}.
 *   - 'AES-CBC-PKCS7'           → {@link signAesCbcPkcs7}.
 *
 * @param args - canonical + canonicalBytes + config + optional keying material.
 * @returns Procedure with the signed value (header string for
 *   asymmetric, base64+postfix for AES).
 */
function signCanonicalDispatch(args: ISignDispatchArgs): Procedure<string> {
  if (args.config.algorithm === 'AES-CBC-PKCS7') return dispatchAesBranch(args);
  return dispatchAsymmetricBranch(args);
}

export type { ISignDispatchArgs };
export default signCanonical;
export { signCanonical, signCanonicalDispatch };
