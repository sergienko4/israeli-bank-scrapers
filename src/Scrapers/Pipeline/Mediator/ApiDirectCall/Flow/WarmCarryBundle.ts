/**
 * WarmCarryBundle — the warm token of a bank whose warm login needs several
 * carry slots a cold login fills, and optionally the session jar too.
 *
 * <p>Wire form: `v1.` + unpadded base64url over UTF-8 JSON `{p, a, s, c?}` —
 * the provider tag, a 16-hex SHA-256 tag of the JSON array of the trimmed
 * account values (never the values), exactly the kept slots, and — only when
 * the config keeps the jar — the cookies in creation order.
 *
 * <p>A token failing any check is refused with a reason from
 * {@link WARM_BUNDLE_REJECTIONS} — never a value, as the slots and jar hold a
 * live session. A blank account value binds nothing, so no bundle is encoded
 * or opened for one. Like every stored warm token, the bundle is a secret its
 * caller keeps; the tags only stop one account's bundle being replayed for
 * another.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { JsonUnknown, JsonUnknownRecord } from '../../../Types/JsonValue.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import type { StoredJar } from './WarmCookieJar.js';
import {
  identityTag,
  isListValue,
  isRecordValue,
  isStoredCookie,
  parseJsonBody,
  projectCookie,
  textAt,
  WARM_TOKEN_PREFIX,
  wrapJsonText,
} from './WarmTokenParts.js';

/** Who a bundle belongs to: a provider and the account values, in order. */
interface IWarmBundleIdentity {
  readonly provider: string;
  readonly accounts: readonly string[];
}

/** What a stored bundle must hold, whose it must be, and its size limit. */
interface IWarmBundleExpectation extends IWarmBundleIdentity {
  readonly slots: readonly string[];
  readonly hasCookies: boolean;
  readonly maxChars: number;
}

/** The kept carry slots, each a non-empty string. */
type BundleCarry = Readonly<Record<string, string>>;

/** A bundle's carry slots and, when kept, its jar. */
interface IWarmBundle {
  readonly carry: BundleCarry;
  readonly cookies: StoredJar | false;
}

/** The decoded `v1` envelope before its slots and jar are checked. */
interface IBundleEnvelope extends JsonUnknownRecord {
  readonly p: string;
  readonly a: string;
  readonly s: JsonUnknownRecord;
}

/** Why a stored bundle was refused — logged as-is, so never a value. */
const WARM_BUNDLE_REJECTIONS = {
  size: 'token longer than maxTokenChars',
  prefix: 'not a v1 carry-bundle token',
  encoding: 'token body is not canonical base64url',
  json: 'token body is not JSON',
  schema: 'token body is not a carry bundle',
  provider: 'token belongs to another provider',
  account: 'token belongs to another account',
  slots: 'token slots do not match the config',
  cookies: 'token cookies do not match the config',
  cookie: 'token holds a bad cookie record',
  session: 'this run has no cookie session',
  unbound: 'no account to bind the token to',
} as const;

type WarmBundleRejection = keyof typeof WARM_BUNDLE_REJECTIONS;

/**
 * Refuse a stored bundle with a reason only.
 * @param reason - Rejection key.
 * @returns Procedure failure.
 */
function reject(reason: WarmBundleRejection): Procedure<never> {
  return fail(ScraperErrorTypes.Generic, WARM_BUNDLE_REJECTIONS[reason]);
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
 * Tag the account values without storing them.
 * @param accounts - Account values; surrounding spaces ignored.
 * @returns The identity tag of their JSON array.
 */
function accountsTag(accounts: readonly string[]): string {
  const trimmed = accounts.map((account): string => account.trim());
  const json = JSON.stringify(trimmed);
  return identityTag(json);
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
 * Whether a parsed value is a `v1` bundle envelope.
 * @param value - Parsed token body.
 * @returns True for `{p: string, a: string, s: object}`.
 */
function isBundleEnvelope(value: JsonUnknown): value is IBundleEnvelope {
  if (!isRecordValue(value)) return false;
  const isTagged = typeof value.p === 'string' && typeof value.a === 'string';
  return isTagged && isRecordValue(value.s);
}

/**
 * Read exactly the configured slots, each a non-empty string.
 * @param stored - The envelope's slots.
 * @param slots - Configured slots.
 * @returns The carry in config order, or the `slots` rejection.
 */
function readSlots(stored: JsonUnknownRecord, slots: readonly string[]): Procedure<BundleCarry> {
  const entries = slots.map((slot): readonly [string, string] => [slot, textAt(stored, slot)]);
  const isExact = Object.keys(stored).length === slots.length;
  const isFilled = entries.every(([, text]): boolean => text.length > 0);
  if (!isExact || !isFilled) return reject('slots');
  const carry: BundleCarry = Object.fromEntries(entries);
  return succeed(carry);
}

/**
 * Read the jar, present exactly when the config keeps one.
 * @param envelope - Checked envelope.
 * @param hasCookies - Whether the config keeps the jar.
 * @returns The cookies, false when none is kept, or the rejection.
 */
function readCookies(envelope: IBundleEnvelope, hasCookies: boolean): Procedure<StoredJar | false> {
  if (Object.hasOwn(envelope, 'c') !== hasCookies) return reject('cookies');
  if (!hasCookies) return succeed(false);
  const cookies = envelope.c;
  if (!isListValue(cookies) || !cookies.every(isStoredCookie)) return reject('cookie');
  const projected = cookies.map(projectCookie);
  return succeed(projected);
}

/**
 * Whose bundle an envelope is, against the expected owner.
 * @param envelope - Envelope of a checked shape.
 * @param expected - Expected provider and account values.
 * @returns The first mismatch's rejection key, or false when it is theirs.
 */
function ownerMismatch(
  envelope: IBundleEnvelope,
  expected: IWarmBundleIdentity,
): WarmBundleRejection | false {
  if (envelope.p !== expected.provider) return 'provider';
  if (envelope.a !== accountsTag(expected.accounts)) return 'account';
  return false;
}

/**
 * Read an owned envelope's slots, then its jar.
 * @param envelope - Envelope of a checked shape and owner.
 * @param expected - Expected slots and jar flag.
 * @returns The bundle, or the first failing check's rejection.
 */
function readContents(
  envelope: IBundleEnvelope,
  expected: IWarmBundleExpectation,
): Procedure<IWarmBundle> {
  const carry = readSlots(envelope.s, expected.slots);
  if (!isOk(carry)) return carry;
  const cookies = readCookies(envelope, expected.hasCookies);
  if (!isOk(cookies)) return cookies;
  return succeed({ carry: carry.value, cookies: cookies.value });
}

/**
 * Check the envelope's shape, whose bundle it is, then its slots and jar.
 * @param value - Parsed token body.
 * @param expected - Expected identity, slots and jar flag.
 * @returns The bundle, or the first failing check's rejection.
 */
function checkEnvelope(
  value: JsonUnknown,
  expected: IWarmBundleExpectation,
): Procedure<IWarmBundle> {
  if (!isBundleEnvelope(value)) return reject('schema');
  const mismatch = ownerMismatch(value, expected);
  if (mismatch !== false) return reject(mismatch);
  return readContents(value, expected);
}

/**
 * Encode a bundle for the given provider and account values.
 * @param identity - Provider tag and account values.
 * @param bundle - Kept slots and, when kept, the jar in creation order.
 * @returns A `v1.` token, or the `unbound` rejection.
 */
function encodeWarmBundle(identity: IWarmBundleIdentity, bundle: IWarmBundle): Procedure<string> {
  if (isUnbound(identity.accounts)) return reject('unbound');
  const a = accountsTag(identity.accounts);
  const jar = bundle.cookies === false ? {} : { c: bundle.cookies.map(projectCookie) };
  const json = JSON.stringify({ p: identity.provider, a, s: bundle.carry, ...jar });
  const token = wrapJsonText(json);
  return succeed(token);
}

/**
 * Open a stored bundle, checking in order: an account to bind, size, prefix,
 * encoding, JSON, schema, provider, account, slots, jar presence, cookies.
 * Runs no network request.
 * @param token - Stored token.
 * @param expected - Expected identity, slots, jar flag and size limit.
 * @returns The bundle, or the first failing check's rejection.
 */
function decodeWarmBundle(token: string, expected: IWarmBundleExpectation): Procedure<IWarmBundle> {
  if (isUnbound(expected.accounts)) return reject('unbound');
  const text = unwrapBody(token, expected.maxChars);
  if (!isOk(text)) return text;
  const failure = reject('json');
  const parsed = parseJsonBody(text.value, failure);
  if (!isOk(parsed)) return parsed;
  return checkEnvelope(parsed.value, expected);
}

export type { BundleCarry, IWarmBundle };
export { decodeWarmBundle, encodeWarmBundle, WARM_BUNDLE_REJECTIONS };
