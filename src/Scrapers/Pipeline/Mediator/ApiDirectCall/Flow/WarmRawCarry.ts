/**
 * WarmRawCarry — the provider/account-bound envelope for a warm token whose
 * payload is one raw carry string: a login hash, a device key or a JWT.
 *
 * <p>Wire form: `v1.` + unpadded base64url over UTF-8 JSON `{p, a, v}` — the
 * provider tag, a 16-hex account tag (never the account values) and the raw
 * value. A token without the `v1.` prefix is a pre-envelope raw token and is
 * still accepted unchanged; the envelope only binds tokens minted now.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { JsonUnknown, JsonUnknownRecord } from '../../../Types/JsonValue.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import {
  accountsMatch,
  accountsTag,
  isRecordValue,
  parseJsonBody,
  WARM_TOKEN_PREFIX,
  wrapJsonText,
} from './WarmTokenParts.js';

/** Who a raw token belongs to: provider and account values, in order. */
interface IRawCarryIdentity {
  readonly provider: string;
  readonly accounts: readonly string[];
  /** Password or bank fallback key; '' keeps the legacy unkeyed tag. */
  readonly tagKey?: string;
}

/** What a stored raw token must belong to, and its size limit. */
interface IRawCarryExpectation extends IRawCarryIdentity {
  readonly maxChars: number;
}

/** The decoded `v1` envelope before the raw value is read. */
interface IRawCarryEnvelope extends JsonUnknownRecord {
  readonly p: string;
  readonly a: string;
  readonly v: string;
}

/** Why a stored raw token was refused — logged as-is, so never a value. */
const WARM_RAW_CARRY_REJECTIONS = {
  size: 'token longer than maxTokenChars',
  prefix: 'not a v1 raw-carry token',
  encoding: 'token body is not canonical base64url',
  json: 'token body is not JSON',
  schema: 'token body is not a raw-carry token',
  provider: 'token belongs to another provider',
  account: 'token belongs to another account',
  value: 'token carries no value',
  unbound: 'no account to bind the token to',
} as const;

type WarmRawCarryRejection = keyof typeof WARM_RAW_CARRY_REJECTIONS;

/**
 * Refuse a stored raw token with a reason only.
 * @param reason - Rejection key.
 * @returns Procedure failure.
 */
function reject(reason: WarmRawCarryRejection): Procedure<never> {
  return fail(ScraperErrorTypes.Generic, WARM_RAW_CARRY_REJECTIONS[reason]);
}

/**
 * Whether the account values bind nothing.
 * @param accounts - Account values from the creds.
 * @returns True when there are none or any is blank.
 */
function isUnbound(accounts: readonly string[]): boolean {
  if (accounts.length === 0) return true;
  return accounts.some((account): boolean => account.trim().length === 0);
}

/**
 * Whether a parsed value is a `v1` raw-carry envelope.
 * @param value - Parsed token body.
 * @returns True for `{p: string, a: string, v: string}`.
 */
function isRawCarryEnvelope(value: JsonUnknown): value is IRawCarryEnvelope {
  if (!isRecordValue(value)) return false;
  const isTagged = typeof value.p === 'string' && typeof value.a === 'string';
  const isValue = typeof value.v === 'string';
  return isTagged && isValue && Object.keys(value).length === 3;
}

/**
 * Check the size, prefix and canonical base64url, then unwrap the body text.
 * @param token - Stored token.
 * @param maxChars - Inclusive size limit.
 * @returns Body JSON text, or the rejection.
 */
function unwrapBody(token: string, maxChars: number): Procedure<string> {
  if (token.length > maxChars) return reject('size');
  if (!token.startsWith(WARM_TOKEN_PREFIX)) return reject('prefix');
  const body = token.slice(WARM_TOKEN_PREFIX.length);
  const bytes = Buffer.from(body, 'base64url');
  if (bytes.toString('base64url') !== body) return reject('encoding');
  const text = bytes.toString('utf8');
  return succeed(text);
}

/**
 * Check the envelope's shape, whose token it is, and that it carries a value.
 * @param value - Parsed token body.
 * @param expected - Expected identity.
 * @returns The raw value, or the first failing check's rejection.
 */
function checkEnvelope(value: JsonUnknown, expected: IRawCarryIdentity): Procedure<string> {
  if (!isRawCarryEnvelope(value)) return reject('schema');
  if (value.p !== expected.provider) return reject('provider');
  if (!accountsMatch(value.a, expected.accounts, expected.tagKey ?? '')) {
    return reject('account');
  }
  if (value.v.length === 0) return reject('value');
  return succeed(value.v);
}

/**
 * Encode one raw value for the given provider and account values.
 * @param identity - Provider tag and account values.
 * @param value - Raw carry to keep.
 * @returns A `v1.` token, or the `unbound` rejection.
 */
function encodeRawCarry(identity: IRawCarryIdentity, value: string): Procedure<string> {
  if (isUnbound(identity.accounts)) return reject('unbound');
  if (value.length === 0) return reject('value');
  const a = accountsTag(identity.accounts, identity.tagKey ?? '');
  const json = JSON.stringify({ p: identity.provider, a, v: value });
  const token = wrapJsonText(json);
  return succeed(token);
}

/**
 * Open a stored raw token, checking in order: an account to bind, size,
 * prefix, encoding, JSON, schema, provider, account and value. Runs no
 * network request.
 * @param token - Stored token.
 * @param expected - Expected identity and size limit.
 * @returns The raw value, or the first failing check's rejection.
 */
function decodeRawCarry(token: string, expected: IRawCarryExpectation): Procedure<string> {
  if (isUnbound(expected.accounts)) return reject('unbound');
  const text = unwrapBody(token, expected.maxChars);
  if (!isOk(text)) return text;
  const failure = reject('json');
  const parsed = parseJsonBody(text.value, failure);
  if (!isOk(parsed)) return parsed;
  return checkEnvelope(parsed.value, expected);
}

/**
 * Whether a stored token uses the `v1.` envelope rather than the legacy raw
 * form.
 * @param token - Stored token.
 * @returns True when the token starts with the shared version prefix.
 */
function isRawCarryToken(token: string): boolean {
  return token.startsWith(WARM_TOKEN_PREFIX);
}

export type { IRawCarryExpectation };
export { decodeRawCarry, encodeRawCarry, isRawCarryToken };
