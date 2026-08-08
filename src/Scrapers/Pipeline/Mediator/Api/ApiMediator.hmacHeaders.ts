/**
 * Transport-level HMAC request-header signing for the mediator.
 *
 * When a bootstrap step has deposited a per-session HMAC key + a header
 * signer directive into the mediator session context, every outbound
 * authenticated call gains three signature headers computed over the
 * final method + path + body bytes. Fully bank-agnostic (Rule #11): the
 * key is a runtime artifact and the header names come from config.
 * Absent key or directive → no headers (the getKey bootstrap exemption).
 */

import { isOk } from '../../Types/Procedure.js';
import type { IHmacHeaderSignerConfig } from '../ApiDirectCall/ConfigContracts/SignerTypes.js';
import type {
  ISignedRequest,
  ISignRequestArgs,
} from '../ApiDirectCall/Crypto/HmacRequestSigner.js';
import { mintNonce, signRequest } from '../ApiDirectCall/Crypto/HmacRequestSigner.js';
import type { SessionContext } from './ApiMediator.types.js';

/** Session-context slot carrying the 32-byte HMAC key as lowercase hex. */
const HMAC_KEY_SLOT = 'hmacSigningKeyHex';

/** Session-context slot carrying the {@link IHmacHeaderSignerConfig} directive. */
const HMAC_SIGNER_SLOT = 'hmacHeaderSigner';

/** No headers — shared singleton for the unsigned (bootstrap) path. */
const NO_HMAC_HEADERS: Record<string, string> = Object.freeze({});

/** Inputs for {@link buildHmacHeaders} — options object (≤3-param ceiling). */
interface IHmacHeadersArgs {
  readonly session: SessionContext;
  readonly method: string;
  readonly url: string;
  readonly body?: Record<string, unknown>;
}

/**
 * Read the hex HMAC key from the session context.
 * @param session - Mediator session-context snapshot.
 * @returns Lowercase-hex key, or '' when unset.
 */
function readKeyHex(session: SessionContext): string {
  const value = session[HMAC_KEY_SLOT];
  return typeof value === 'string' ? value : '';
}

/**
 * Report whether a value is a usable HTTP header name.
 * @param value - Candidate header name from the signer directive.
 * @returns True for a non-empty string.
 */
function isHeaderName(value: unknown): boolean {
  return typeof value === 'string' && value !== '';
}

/**
 * Narrow an unknown session value to the header-signer directive.
 *
 * <p>The three header NAMES are validated, not just the algorithm tag:
 * {@link toHeaderMap} spreads them as computed keys, so a directive that
 * carries the tag but omits a name would silently emit a header literally
 * called `undefined` and drop the real one — a signed request the bank
 * rejects for a reason nothing in the log explains.
 * @param value - Raw session-context value.
 * @returns True when the value is a complete HMAC-SHA256 directive.
 */
function isHmacSigner(value: unknown): value is IHmacHeaderSignerConfig {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<IHmacHeaderSignerConfig>;
  if (candidate.algorithm !== 'HMAC-SHA256') return false;
  const hasTimestamp = isHeaderName(candidate.timestampHeader);
  const hasNonce = isHeaderName(candidate.nonceHeader);
  const hasSignature = isHeaderName(candidate.signatureHeader);
  return hasTimestamp && hasNonce && hasSignature;
}

/**
 * Serialize the outbound body to the exact bytes the fetch strategy
 * sends (`JSON.stringify`), or an empty buffer for bodyless GETs.
 * @param body - Final outbound body (undefined for GET).
 * @returns UTF-8 body bytes.
 */
function toBodyBytes(body?: Record<string, unknown>): Buffer {
  if (body === undefined) return Buffer.alloc(0);
  const json = JSON.stringify(body);
  return Buffer.from(json, 'utf8');
}

/** Bundled signing inputs resolved from the session context. */
interface IResolvedSigning {
  readonly keyHex: string;
  readonly signer: IHmacHeaderSignerConfig;
  readonly args: IHmacHeadersArgs;
}

/**
 * Assemble the three signature headers from a computed signature.
 * @param signer - Header-name directive.
 * @param signed - Computed signature bundle.
 * @returns Header map keyed by the configured names.
 */
function toHeaderMap(
  signer: IHmacHeaderSignerConfig,
  signed: ISignedRequest,
): Record<string, string> {
  return {
    [signer.timestampHeader]: signed.timestamp,
    [signer.nonceHeader]: signed.nonce,
    [signer.signatureHeader]: signed.signature,
  };
}

/**
 * Build the per-request signing inputs from a resolved (key + args)
 * bundle, minting a fresh timestamp + nonce for this attempt.
 * @param resolved - Key, directive, and request args.
 * @returns Inputs for {@link signRequest}.
 */
function buildSignArgs(resolved: IResolvedSigning): ISignRequestArgs {
  const url = new URL(resolved.args.url);
  const nowMs = Date.now();
  const bodyBytes = toBodyBytes(resolved.args.body);
  const hmacKey = Buffer.from(resolved.keyHex, 'hex');
  const timestamp = String(nowMs);
  const nonce = mintNonce();
  return { method: resolved.args.method, path: url.pathname, bodyBytes, hmacKey, timestamp, nonce };
}

/**
 * Compute the signature headers for a resolved (key + directive) request.
 * @param resolved - Key, directive, and request args.
 * @returns Header map, or no headers when signing fails.
 */
function signResolved(resolved: IResolvedSigning): Record<string, string> {
  const signArgs = buildSignArgs(resolved);
  const signed = signRequest(signArgs);
  if (!isOk(signed)) return NO_HMAC_HEADERS;
  return toHeaderMap(resolved.signer, signed.value);
}

/**
 * Build the per-request HMAC signature headers, or no headers when the
 * session carries no key/directive (the pre-getKey bootstrap window).
 * @param args - Session context + method + resolved URL + final body.
 * @returns Header map to merge into the outbound request.
 */
function buildHmacHeaders(args: IHmacHeadersArgs): Record<string, string> {
  const keyHex = readKeyHex(args.session);
  const signerValue = args.session[HMAC_SIGNER_SLOT];
  if (keyHex === '' || !isHmacSigner(signerValue)) return NO_HMAC_HEADERS;
  return signResolved({ keyHex, signer: signerValue, args });
}

export { buildHmacHeaders, HMAC_KEY_SLOT, HMAC_SIGNER_SLOT, NO_HMAC_HEADERS };
export type { IHmacHeadersArgs };
