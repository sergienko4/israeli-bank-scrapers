/**
 * Resolves the OneZero client certificate + key used for the Cloudflare
 * API Shield mutual-TLS handshake. Order of resolution per part (cert, key):
 *   1. Env override — inline PEM or a filesystem path to a PEM file:
 *        - `ONEZERO_MTLS_CERT` — client certificate (PEM text or file path).
 *        - `ONEZERO_MTLS_KEY`  — matching private key (PEM text or file path).
 *      A value containing `-----BEGIN` is treated as inline PEM; otherwise it is
 *      read from disk. Enables rotation (or per-deployment isolation) without a
 *      release. An invalid/unreadable override logs a WARN and falls back to the
 *      bundled default rather than failing the scrape.
 *   2. Bundled base64 default (see OneZeroClientCertData) — the app-shared cert
 *      extracted from the public OneZero APK, valid ~yearly.
 *
 * SECURITY: the bundled key is NOT user PII and NOT a per-user secret. It is a
 * shared *application* credential that authenticates the OneZero mobile client
 * (not the account holder) and is already publicly extractable from the APK, so
 * shipping it is what lets the scraper work out of the box. Deployments that
 * require their own identity can supply the env overrides above. A near-expiry
 * (or expired) WARN is logged so rotation is visible before the gate 403s.
 */

import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { getDebug } from '../../../Types/Debug.js';
import { toErrorMessage } from '../../../Types/ErrorUtils.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import { ONEZERO_CERT_B64, ONEZERO_KEY_B64 } from './OneZeroClientCertData.js';

/** Module logger — name derived from source filename per project convention. */
const LOG = getDebug(import.meta.url);

/** Substring that distinguishes an inline PEM from a filesystem path. */
const PEM_MARKER = '-----BEGIN';

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
 * Resolve a single PEM part (cert or key): env override wins when it yields
 * valid PEM, else fall back to the bundled base64 default.
 * @param envVar - Name of the override env var.
 * @param fallbackB64 - Base64-wrapped bundled default.
 * @returns The resolved PEM text.
 */
function resolvePart(envVar: string, fallbackB64: string): string {
  const override = process.env[envVar];
  if (override === undefined || override === '') return decodeB64Pem(fallbackB64);
  const resolved = resolveOverride(override);
  if (isOk(resolved) && looksLikePem(resolved.value)) return resolved.value;
  LOG.warn({ envVar, message: '[mtls] override invalid; using bundled default' });
  return decodeB64Pem(fallbackB64);
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
 * Emit a WARN when the cert is at/near expiry, distinguishing already-expired
 * from soon-to-expire so operators can triage urgency.
 * @param days - Days until expiry (negative when already expired).
 * @returns True when a warning was emitted.
 */
function emitExpiryWarning(days: number): boolean {
  if (days > EXPIRY_WARN_DAYS) return false;
  if (days < 0) {
    LOG.warn({ days, message: '[mtls] OneZero client cert EXPIRED — rotate now' });
    return true;
  }
  LOG.warn({ days, message: '[mtls] OneZero client cert near expiry — rotate soon' });
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
 * Resolve the OneZero client certificate bundle (env override → bundled
 * default), logging a near-expiry warning as a side effect.
 * @returns The resolved cert + key PEM pair.
 */
function resolveOneZeroClientCert(): ICertBundle {
  const cert = resolvePart('ONEZERO_MTLS_CERT', ONEZERO_CERT_B64);
  const key = resolvePart('ONEZERO_MTLS_KEY', ONEZERO_KEY_B64);
  warnIfExpiring(cert);
  return { cert, key };
}

export type { ICertBundle };
export { emitExpiryWarning, resolveOneZeroClientCert, warnIfExpiring };
