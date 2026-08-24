/**
 * Resolves the OneZero client certificate + key used for the Cloudflare
 * API Shield mutual-TLS handshake. Order of resolution per part (cert, key):
 *   1. Env override — inline PEM or a filesystem path to a PEM file:
 *        - `ONEZERO_MTLS_CERT` — client certificate (PEM text or file path).
 *        - `ONEZERO_MTLS_KEY`  — matching private key (PEM text or file path).
 *      A value containing `-----BEGIN` is treated as inline PEM; otherwise it is
 *      read from disk. Enables rotation (or per-deployment isolation) without a
 *      release.
 *   2. Bundled base64 default (see OneZeroClientCertData) — the app-shared cert
 *      extracted from the public OneZero APK, valid ~yearly. Used ONLY when
 *      neither override is set.
 *
 * FAIL CLOSED: configuring an override is a statement of intent, so a broken one
 * is an error rather than a hint. When either override is present the resolver
 * requires BOTH, requires each to yield valid PEM, and requires the key to match
 * the certificate — otherwise it throws. Silently substituting the bundled
 * identity for a typo'd path or a failed secret mount would send production
 * traffic under a credential the operator never chose.
 *
 * SECURITY: the private key is confidential material and is never logged; only
 * the env-var *name* and days-to-expiry appear in diagnostics. The bundled key
 * is not user PII and not a per-user secret — it is a shared *application*
 * credential authenticating the OneZero mobile client (not the account holder),
 * already extractable from the public APK, which is what lets the scraper work
 * out of the box. Being public does not make it non-confidential: an operator
 * supplying their own key via the overrides is supplying a real secret, and it
 * is handled with the same care. A near-expiry (or expired) WARN is logged so
 * rotation is visible before the gate starts returning 403.
 */

import { createPrivateKey, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import ScraperError from '../../../../Base/ScraperError.js';
import { getDebug } from '../../../Logging/Debug.js';
import { toErrorMessage } from '../../../Types/ErrorUtils.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import { ONEZERO_CERT_B64, ONEZERO_KEY_B64 } from './OneZeroClientCertData.js';

/** Module logger — name derived from source filename per project convention. */
const LOG = getDebug(import.meta.url);

/** Substring that distinguishes an inline PEM from a filesystem path. */
const PEM_MARKER = '-----BEGIN';

/** Env var holding the client certificate override (inline PEM or path). */
const CERT_ENV = 'ONEZERO_MTLS_CERT';

/** Env var holding the private key override (inline PEM or path). */
const KEY_ENV = 'ONEZERO_MTLS_KEY';

/** Raised when only one half of the override pair is configured. */
const PAIR_MSG = `mtls override incomplete: set both ${CERT_ENV} and ${KEY_ENV}, or neither`;

/** WARN when the bundled cert is within this many days of expiry. */
const EXPIRY_WARN_DAYS = 30;

/** Milliseconds per day (for expiry math). */
const MS_PER_DAY = 86_400_000;

/** A resolved PEM certificate + private key pair. */
interface ICertBundle {
  readonly cert: string;
  readonly key: string;
}

/**
 * Decode a base64-wrapped PEM back to its text form.
 * @param b64 - Base64 of the PEM (whitespace tolerated).
 * @returns The decoded PEM text.
 */
function decodeB64Pem(b64: string): string {
  const compact = b64.replaceAll(/\s+/g, '');
  const buffer = Buffer.from(compact, 'base64');
  return buffer.toString('utf8');
}

/**
 * Heuristic: does this value already contain PEM material?
 * @param value - Candidate string (inline PEM or a path).
 * @returns True when the value looks like inline PEM.
 */
function looksLikePem(value: string): boolean {
  return value.includes(PEM_MARKER);
}

/**
 * Read PEM material from a filesystem path.
 * @param path - Path to a PEM file.
 * @returns Procedure with the file contents, or a read failure.
 */
function readFromPath(path: string): Procedure<string> {
  try {
    const pem = readFileSync(path, 'utf8');
    return succeed(pem);
  } catch (error) {
    const reason = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `mtls override read failed: ${reason}`);
  }
}

/**
 * Resolve an env override to PEM text (inline PEM passes through; otherwise
 * treat the value as a filesystem path).
 * @param raw - The raw env value.
 * @returns Procedure with PEM text, or a read failure.
 */
function resolveOverride(raw: string): Procedure<string> {
  if (looksLikePem(raw)) return succeed(raw);
  return readFromPath(raw);
}

/**
 * Is an override configured for this env var?
 * @param envVar - Name of the override env var.
 * @returns True when the var is set to a non-empty value.
 */
function hasOverride(envVar: string): boolean {
  const raw = process.env[envVar];
  return raw !== undefined && raw !== '';
}

/**
 * Resolve a single PEM part (cert or key) from its env override. Throws rather
 * than falling back, so a broken override never silently swaps the identity.
 * @param envVar - Name of the override env var.
 * @returns The resolved PEM text.
 */
function resolveOverridePart(envVar: string): string {
  const raw = process.env[envVar] ?? '';
  const resolved = resolveOverride(raw);
  if (!isOk(resolved)) throw new ScraperError(resolved.errorMessage);
  if (looksLikePem(resolved.value)) return resolved.value;
  const detail = `mtls override is not PEM material (${envVar})`;
  throw new ScraperError(detail);
}

/**
 * Assert that the private key actually belongs to the certificate, so a
 * mismatched pair fails at init instead of as an opaque TLS alert per request.
 * @param bundle - The resolved cert + key pair.
 * @returns True when the pair matches.
 */
function assertPairMatches(bundle: ICertBundle): boolean {
  const isMatching = checkKeyPair(bundle);
  if (isMatching) return true;
  const detail = `mtls certificate and private key do not match (${CERT_ENV}/${KEY_ENV})`;
  throw new ScraperError(detail);
}

/**
 * Best-effort cryptographic pairing check; unparseable material counts as a
 * mismatch so it is reported through the same fail-closed path.
 * @param bundle - The resolved cert + key pair.
 * @returns True when the key provably matches the certificate.
 */
function checkKeyPair(bundle: ICertBundle): boolean {
  try {
    const x509 = new X509Certificate(bundle.cert);
    const keyObject = createPrivateKey(bundle.key);
    return x509.checkPrivateKey(keyObject);
  } catch {
    return false;
  }
}

/**
 * Resolve the cert + key from the env overrides, requiring both halves.
 * @returns The override-supplied PEM pair.
 */
function resolveFromOverrides(): ICertBundle {
  const cert = resolveOverridePart(CERT_ENV);
  const key = resolveOverridePart(KEY_ENV);
  const bundle: ICertBundle = { cert, key };
  assertPairMatches(bundle);
  return bundle;
}

/**
 * Decode the bundled base64 default pair shipped with the package.
 * @returns The bundled PEM pair.
 */
function resolveBundledDefault(): ICertBundle {
  const cert = decodeB64Pem(ONEZERO_CERT_B64);
  const key = decodeB64Pem(ONEZERO_KEY_B64);
  return { cert, key };
}

/**
 * Parse the certificate's notAfter date.
 * @param cert - PEM certificate text.
 * @returns Procedure with the validTo Date, or a parse failure.
 */
function certValidTo(cert: string): Procedure<Date> {
  try {
    const x509 = new X509Certificate(cert);
    const validTo = new Date(x509.validTo);
    return succeed(validTo);
  } catch (error) {
    const reason = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `mtls cert parse failed: ${reason}`);
  }
}

/**
 * Whole days from now until the given date (negative when already expired).
 * @param date - Target date.
 * @returns Whole-day delta.
 */
function daysUntil(date: Date): number {
  const deltaMs = date.getTime() - Date.now();
  return Math.floor(deltaMs / MS_PER_DAY);
}

/**
 * WARN text for a certificate that has already passed its notAfter date.
 */
const EXPIRED_MSG = '[mtls] OneZero client cert EXPIRED — rotate now';

/**
 * WARN text for a certificate inside the near-expiry window.
 */
const NEAR_EXPIRY_MSG = '[mtls] OneZero client cert near expiry — rotate soon';

/**
 * Select the expiry WARN text for a days-to-expiry value. Kept separate from
 * emission so each branch is directly assertable.
 * @param days - Days until expiry (negative when already expired).
 * @returns The warning text, or an empty string when no warning is due.
 */
function expiryMessage(days: number): string {
  if (days > EXPIRY_WARN_DAYS) return '';
  if (days < 0) return EXPIRED_MSG;
  return NEAR_EXPIRY_MSG;
}

/**
 * Emit a WARN when the cert is at/near expiry, distinguishing already-expired
 * from soon-to-expire so operators can triage urgency.
 * @param days - Days until expiry (negative when already expired).
 * @returns True when a warning was emitted.
 */
function emitExpiryWarning(days: number): boolean {
  const message = expiryMessage(days);
  if (message === '') return false;
  LOG.warn({ days, message });
  return true;
}

/**
 * Log that the expiry check was skipped (cert unparseable).
 * @returns Always false (no warning emitted).
 */
function logExpirySkipped(): boolean {
  LOG.debug({ message: '[mtls] cert expiry check skipped (unparseable)' });
  return false;
}

/**
 * Warn when the resolved cert is at/near expiry (best-effort; never throws).
 * @param cert - PEM certificate text.
 * @returns True when a near-expiry warning was emitted.
 */
function warnIfExpiring(cert: string): boolean {
  const parsed = certValidTo(cert);
  if (!isOk(parsed)) return logExpirySkipped();
  const days = daysUntil(parsed.value);
  return emitExpiryWarning(days);
}

/**
 * Assert the override pair is all-or-nothing, so an override certificate is
 * never paired with the bundled key (or vice versa).
 * @returns True when at least one override is configured.
 */
function hasCompleteOverride(): boolean {
  const isCertSet = hasOverride(CERT_ENV);
  const isKeySet = hasOverride(KEY_ENV);
  if (isCertSet === isKeySet) return isCertSet;
  throw new ScraperError(PAIR_MSG);
}

/**
 * Resolve the OneZero client certificate bundle (complete env override pair →
 * bundled default), logging a near-expiry warning as a side effect.
 * @returns The resolved cert + key PEM pair.
 */
function resolveOneZeroClientCert(): ICertBundle {
  const isOverridden = hasCompleteOverride();
  const bundle = isOverridden ? resolveFromOverrides() : resolveBundledDefault();
  warnIfExpiring(bundle.cert);
  return bundle;
}

export type { ICertBundle };
export {
  emitExpiryWarning,
  EXPIRED_MSG,
  expiryMessage,
  NEAR_EXPIRY_MSG,
  resolveOneZeroClientCert,
  warnIfExpiring,
};
