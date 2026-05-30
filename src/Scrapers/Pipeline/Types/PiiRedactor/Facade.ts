/**
 * PiiRedactor Facade — unified entry point composing every
 * per-category strategy.
 *
 * Single source of truth for PII redaction across every persisted log
 * destination of this package. Destinations covered (no bypass paths):
 *
 *  - Pino terminal stream (pino-pretty)         via createCensorFn()
 *  - Pino file stream (pipeline.log)            via createCensorFn()
 *  - NetworkDiscovery.dumpResponseBody          via redactJsonBody()
 *  - FixtureCapture HTML / metadata writers     via redactHtml() /
 *                                               redactJsonBody()
 *  - Test result formatter                      via per-strategy exports
 *
 * Hosts the path-tail → category routing table, the strategy
 * registry, the Pino `createCensorFn()` factory, and the unified
 * value-only {@link redact} entry point used by call-sites that lack
 * a structured path (CLI, free-form logger arguments).
 *
 * Auth credentials (token / OTP / cookie) are matched FIRST inside
 * `redact()` and ALWAYS produce a stable hint — `PII_REDACTION=off`
 * cannot leak them through this entry point.
 *
 * Spec: pipeline-decoupling-master-2026-05-28 / phase-6 / spec.txt §3.
 */

import { redactAccount } from './Account.js';
import { redactAmount } from './Amount.js';
import {
  looksLikeCookie,
  looksLikeOtp,
  looksLikeToken,
  redactCookie,
  redactOtp,
  redactToken,
} from './AuthCredentials.js';
import { redactCard } from './Card.js';
import { redactIsraeliId } from './IsraeliId.js';
import { redactMerchant } from './Merchant.js';
import { redactName } from './Name.js';
import { redactPhone } from './Phone.js';
import {
  OTP_HINT,
  type PiiCategory,
  type PiiClassifierBool,
  type PiiHintString,
  REDACTED_HINT,
  REDACTION_ERROR_HINT,
} from './Types.js';

/** Pino's redact callback value type — strings, numbers, or booleans. */
export type CensorValue = string | number | boolean;

/** Pino's redact callback signature — value+path → string. */
export type CensorFn = (value: CensorValue, path: readonly string[]) => string;

/** Path-tail key → PiiCategory routing table (Partial, missing keys → undefined). */
export const PATH_TAIL_TO_CATEGORY: Readonly<Partial<Record<string, PiiCategory>>> = {
  accountNumber: 'account',
  accountId: 'account',
  bankAccountNum: 'account',
  cardSuffix: 'card',
  last4Digits: 'card',
  cardUniqueId: 'card',
  cardUniqueID: 'card',
  CardId: 'card',
  card6Digits: 'card',
  num: 'account',
  MisparZihuy: 'israeliId',
  israeliId: 'israeliId',
  phoneNumber: 'phone',
  phone: 'phone',
  mobile: 'phone',
  email: 'token',
  firstName: 'name',
  lastName: 'name',
  customerName: 'name',
  fullName: 'name',
  username: 'name',
  userName: 'name',
  UserName: 'name',
  Username: 'name',
  description: 'merchant',
  merchant: 'merchant',
  payee: 'merchant',
  balance: 'amount',
  chargedAmount: 'amount',
  originalAmount: 'amount',
  eventAmount: 'amount',
  bearer: 'token',
  authorization: 'token',
  Authorization: 'token',
  token: 'token',
  idToken: 'token',
  otpToken: 'token',
  otpLongTermToken: 'token',
  smsAssertionId: 'token',
  otpContext: 'token',
  deviceToken: 'token',
  sessionId: 'token',
  deviceId: 'token',
  pwdAssertionId: 'token',
  challenge: 'token',
  password: 'token',
  secret: 'token',
  Sisma: 'token',
  bankAccountUniqueID: 'token',
  bankAccountUniqueId: 'token',
  queryIdentifier: 'token',
  cookies: 'cookie',
  cookie: 'cookie',
  setCookie: 'cookie',
  otpCode: 'otp',
};

/** String-strategy lookup table (excludes amount which has number input). */
const STRING_STRATEGIES: Readonly<Partial<Record<PiiCategory, (value: string) => string>>> = {
  account: redactAccount,
  card: redactCard,
  israeliId: redactIsraeliId,
  phone: redactPhone,
  name: redactName,
  merchant: redactMerchant,
  token: redactToken,
  otp: redactOtp,
  cookie: redactCookie,
};

/** Path-tail suffix list matched by {@link isTokenSuffix} (lowercase). */
const TOKEN_SUFFIXES: readonly string[] = ['token', 'bearer', 'cookie', 'secret'];
/** Path-tail suffix list matched by {@link isNameSuffix} (lowercase). */
const NAME_SUFFIXES: readonly string[] = ['firstname', 'lastname', 'fullname', 'customername'];

/**
 * Whether a path-tail key classifies as token-shaped via case-insensitive
 * suffix match.
 * @param key - Last segment of the path.
 * @returns True when the key looks like a token.
 */
function isTokenSuffix(key: string): PiiClassifierBool {
  const lower = key.toLowerCase();
  return TOKEN_SUFFIXES.some((s): boolean => lower.endsWith(s)) as PiiClassifierBool;
}

/**
 * Whether a path-tail key classifies as a name-shaped value via
 * case-insensitive suffix match. Bare `name` is intentionally NOT
 * matched — too many non-PII uses.
 * @param key - Last segment of the path.
 * @returns True when the key looks like a personal-name field.
 */
function isNameSuffix(key: string): PiiClassifierBool {
  const lower = key.toLowerCase();
  return NAME_SUFFIXES.some((s): boolean => lower.endsWith(s)) as PiiClassifierBool;
}

/**
 * Classify a path's tail key into a PiiCategory.
 * @param key - Path tail key.
 * @returns Resolved category.
 */
export function classifyKey(key: string): PiiCategory {
  const direct = PATH_TAIL_TO_CATEGORY[key];
  if (direct !== undefined) return direct;
  if (isTokenSuffix(key)) return 'token';
  if (isNameSuffix(key)) return 'name';
  return 'unknown';
}

/** Args bundle for dispatchStrategy — keeps the function signature typed. */
interface IDispatchArgs {
  readonly value: CensorValue;
  readonly category: PiiCategory;
}

/**
 * Coerce a censor input to its string form for lookup-table dispatch.
 * @param value - Pino value (string | number | boolean).
 * @returns String coercion.
 */
function toStringValue(value: CensorValue): PiiHintString {
  if (typeof value === 'string') return value as PiiHintString;
  return String(value) as PiiHintString;
}

/**
 * Coerce a censor input to a number-or-string for redactAmount.
 * @param value - Pino value.
 * @returns Number when value is number, else its string form.
 */
function toAmountValue(value: CensorValue): number | string {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return String(value);
  return value;
}

/**
 * Dispatch a single value+category pair to the matching strategy.
 * @param args - Bundled value + category.
 * @returns Stable hint.
 */
function dispatchStrategy(args: IDispatchArgs): PiiHintString {
  if (args.category === 'amount') {
    const amountInput = toAmountValue(args.value);
    return redactAmount(amountInput);
  }
  const strategy = STRING_STRATEGIES[args.category];
  if (strategy === undefined) return REDACTED_HINT as PiiHintString;
  const stringInput = toStringValue(args.value);
  return strategy(stringInput) as PiiHintString;
}

/**
 * Classify + dispatch a single censor invocation. Strategy throws are
 * translated to {@link REDACTION_ERROR_HINT} so the censor caller
 * never propagates internal errors back to pino.
 * @param value - Value being censored.
 * @param tail - Non-empty path tail (last key).
 * @returns Stable hint string.
 */
function censorTail(value: CensorValue, tail: string): PiiHintString {
  try {
    return dispatchStrategy({ value, category: classifyKey(tail) });
  } catch {
    return REDACTION_ERROR_HINT as PiiHintString;
  }
}

/**
 * Pino redact callback factory. Each invocation classifies the path
 * tail, dispatches to a strategy, and returns the stable hint string.
 * Strategy throws are caught and translated to '[REDACTION_ERROR]'.
 * @returns Censor function bound to the production strategy table.
 */
export function createCensorFn(): CensorFn {
  return (value, path): PiiHintString => {
    if (path.length === 0) return REDACTED_HINT as PiiHintString;
    const tail = path.at(-1);
    if (tail === undefined || tail.length === 0) return REDACTED_HINT as PiiHintString;
    return censorTail(value, tail);
  };
}

/**
 * Inner classification body for {@link redact}. Auth-credential
 * sniffers run FIRST so `PII_REDACTION=off` cannot leak them.
 * @param value - Candidate string already proven to be a string.
 * @returns Stable hint string.
 */
function redactStringValue(value: string): PiiHintString {
  if (looksLikeToken(value)) return REDACTED_HINT as PiiHintString;
  if (looksLikeOtp(value)) return OTP_HINT as PiiHintString;
  if (looksLikeCookie(value)) return REDACTED_HINT as PiiHintString;
  return REDACTED_HINT as PiiHintString;
}

/**
 * Unified PII redaction entry point. Default-deny: any unclassified
 * value yields {@link REDACTED_HINT}. Auth credentials (token / OTP /
 * cookie) are matched FIRST so `PII_REDACTION=off` cannot leak them.
 * @param value - Arbitrary input value.
 * @returns Stable hint string.
 */
export function redact(value: unknown): PiiHintString {
  if (typeof value !== 'string') return REDACTED_HINT as PiiHintString;
  try {
    return redactStringValue(value);
  } catch {
    return REDACTION_ERROR_HINT as PiiHintString;
  }
}
