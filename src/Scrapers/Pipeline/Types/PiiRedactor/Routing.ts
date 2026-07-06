/**
 * PiiRedactor / Routing — path-tail key → PiiCategory classifier.
 *
 * Extracted from `Facade.ts` in Phase 8.5c / C1 (split). Owns the
 * routing table, the case-insensitive suffix lists, and the
 * `classifyKey()` resolver. No knowledge of strategies — that lives
 * in `Dispatch.ts`. No knowledge of the unified `redact()` entry
 * point — that lives in `Facade.ts`.
 *
 * Spec: pipeline-decoupling-master-2026-05-28 / phase-6 / spec.txt §3.
 */

import type { PiiCategory, PiiClassifierBool } from './Types.js';

/** Path-tail key → PiiCategory routing table (Partial, missing keys → undefined). */
export const PATH_TAIL_TO_CATEGORY: Readonly<Partial<Record<string, PiiCategory>>> = {
  accountNumber: 'account',
  accountId: 'account',
  bankAccountNum: 'account',
  iorId: 'account',
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
  csrfTkn: 'token',
  TokenId: 'token',
  Signature: 'token',
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
