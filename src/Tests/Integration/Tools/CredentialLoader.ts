/**
 * Per-bank credential loader for the integration harvester.
 *
 * <p>Reads bank credentials from `process.env` using the EXACT env-var
 * names already established by the E2eReal / E2eFull test suites. No
 * `.env` parser is shipped here — the surrounding test runner (or the
 * harvester's CLI entrypoint) is responsible for loading `.env` into
 * `process.env` before invoking {@link loadCredentials}.
 *
 * <p>Returns the shape expected by each bank's pipeline
 * `ScraperCredentials`. Any missing required key raises a clear error
 * naming the bank + the missing env-var so the operator can fix the
 * `.env` file in one step without spelunking through bank-specific
 * test files.
 *
 * <p>This module is for the harvester only — production code never
 * imports it. It lives under `Tests/Integration/Tools/` so the
 * `testPathIgnorePatterns` + `collectCoverageFrom` exclusions in
 * `jest.config.js` apply.
 */

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import { none, type Option, some } from '../../../Scrapers/Pipeline/Types/Option.js';

/** Generic credential record — string-keyed, string-valued. */
type BankCredentials = Readonly<Record<string, string>>;

/** Per-bank env-var map: bankId → { credentialKey: envVarName }. */
const BANK_ENV_MAP: Readonly<Partial<Record<string, Readonly<Record<string, string>>>>> = {
  isracard: {
    id: 'ISRACARD_ID',
    card6Digits: 'ISRACARD_CARD6DIGITS',
    password: 'ISRACARD_PASSWORD',
  },
  amex: { id: 'AMEX_ID', card6Digits: 'AMEX_CARD6DIGITS', password: 'AMEX_PASSWORD' },
  max: { username: 'MAX_USERNAME', password: 'MAX_PASSWORD' },
  discount: { id: 'DISCOUNT_ID', password: 'DISCOUNT_PASSWORD', num: 'DISCOUNT_NUM' },
  visaCal: { username: 'VISACAL_USERNAME', password: 'VISACAL_PASSWORD' },
  hapoalim: { userCode: 'HAPOALIM_USER_CODE', password: 'HAPOALIM_PASSWORD' },
  beinleumi: { username: 'BEINLEUMI_USERNAME', password: 'BEINLEUMI_PASSWORD' },
};

/** Optional env-var holding a pre-loaded OTP value per OTP bank. */
const OTP_ENV_MAP: Readonly<Partial<Record<string, string>>> = {
  beinleumi: 'BEINLEUMI_OTP',
};

/**
 * List the bankIds the credential loader knows about.
 * @returns Sorted snapshot of bankIds with credential templates.
 */
function knownBanks(): readonly string[] {
  return Object.keys(BANK_ENV_MAP).sort();
}

/**
 * Resolve the env-var template for a bank or fail clearly.
 * @param bankId - Canonical bankId (matches harvester recipe keys).
 * @returns The credential-key → env-var map.
 */
function resolveTemplate(bankId: string): Readonly<Record<string, string>> {
  const template = BANK_ENV_MAP[bankId];
  if (template === undefined) {
    throw new ScraperError(`no credential template registered for bankId "${bankId}"`);
  }
  return template;
}

/**
 * Build the error message for a missing required env-var.
 *
 * @param bankId - Bank identifier for context.
 * @param envVarName - The expected env-var name.
 * @param credentialKey - Credential field name.
 * @returns Human-readable error message string.
 */
function missingEnvMessage(bankId: string, envVarName: string, credentialKey: string): string {
  return `bank "${bankId}" missing required env var ${envVarName} (credential key "${credentialKey}")`;
}

/**
 * Read one env-var and return `[credentialKey, value]` or throw.
 * @param credentialKey - Pipeline credential field name (e.g. `userCode`).
 * @param envVarName - process.env key to read.
 * @param bankId - For error message context.
 * @returns Tuple consumed by `Object.fromEntries`.
 */
function readEnvOrThrow(
  credentialKey: string,
  envVarName: string,
  bankId: string,
): readonly [string, string] {
  const raw = process.env[envVarName];
  if (raw === undefined || raw.trim() === '')
    throw new ScraperError(missingEnvMessage(bankId, envVarName, credentialKey));
  return [credentialKey, raw];
}

/**
 * Load credentials for one bank from the current process environment.
 * @param bankId - Canonical bankId (matches harvester recipe keys).
 * @returns Bank credentials as a frozen record.
 */
function loadCredentials(bankId: string): BankCredentials {
  const template = resolveTemplate(bankId);
  const entries = Object.keys(template).map(key => readEnvOrThrow(key, template[key], bankId));
  const credentials: BankCredentials = Object.fromEntries(entries);
  return Object.freeze(credentials);
}

/**
 * Look up the optional OTP for an OTP bank. Returns `none()` when the
 * env-var is absent (caller decides whether to prompt operator).
 * @param bankId - Canonical bankId.
 * @returns Some(otpDigits) when present and non-empty, otherwise none.
 */
function loadOtpFromEnv(bankId: string): Option<string> {
  const envVarName = OTP_ENV_MAP[bankId];
  if (envVarName === undefined) return none();
  const raw = process.env[envVarName];
  if (raw === undefined || raw.trim() === '') return none();
  return some(raw);
}

/**
 * Test if a bank has full credentials available in `process.env`.
 * Non-throwing — returns false on first missing key so the caller
 * can skip a bank cleanly when unattended harvesting is preferred.
 * @param bankId - Canonical bankId.
 * @returns True if every required env-var is present and non-empty.
 */
function hasCredentials(bankId: string): boolean {
  const template = BANK_ENV_MAP[bankId];
  if (template === undefined) return false;
  const envVars = Object.values(template);
  return envVars.every(isEnvVarPresent);
}

/**
 * Per-env-var presence check used by {@link hasCredentials}.
 * @param envVar - Name of the env var to probe.
 * @returns True when `process.env[envVar]` is set and non-blank.
 */
function isEnvVarPresent(envVar: string): boolean {
  const raw = process.env[envVar];
  return raw !== undefined && raw.trim() !== '';
}

export type { BankCredentials };
export { BANK_ENV_MAP, hasCredentials, knownBanks, loadCredentials, loadOtpFromEnv, OTP_ENV_MAP };
