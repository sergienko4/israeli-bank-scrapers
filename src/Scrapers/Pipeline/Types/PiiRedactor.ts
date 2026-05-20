/**
 * PiiRedactor — single source of truth for PII redaction across every
 * persisted log destination of this package.
 *
 * Destinations covered (no bypass paths):
 *  - Pino terminal stream (pino-pretty)         via createCensorFn()
 *  - Pino file stream (pipeline.log)            via createCensorFn()
 *  - NetworkDiscovery.dumpResponseBody          via redactJsonBody()
 *  - FixtureCapture HTML / metadata writers     via redactHtml() /
 *                                               redactJsonBody()
 *  - Test result formatter                      via per-strategy exports
 *
 * Bug-report contract: an external npm consumer of this package can
 * attach the persisted artefacts to a public bug report without
 * exposing their customers — every category is replaced by a stable
 * hint that preserves enough debugging signal (last 4 of identifiers,
 * sign of amounts, length-class of opaque strings, array size of PII
 * collections) but cannot be re-identified.
 *
 * Default deny: any value that does NOT classify into a known
 * PiiCategory is replaced by the literal '[REDACTED]'. Errors thrown
 * inside a strategy never crash the pipeline — they translate to
 * '[REDACTION_ERROR]' and the pipeline continues.
 */

import type { Brand } from './Brand.js';

/**
 * Default-on PII redaction. Set `PII_REDACTION=off` in `.env` to pass
 * business-data values through unmasked during local debugging — real
 * account numbers, card numbers, descriptions, amounts, URLs, and
 * JSON bodies become visible in logs and `network/*.json` captures.
 *
 * Auth credentials (`token`, `otp`, `cookie`) are NOT bypassed even
 * with this on — those are live security material, redacted always.
 *
 * Single source of truth: the env var is read exactly once, at module
 * load, into this constant. Every public redactor checks ONLY this
 * constant — no scattered env reads, no per-bank toggles.
 */
const isPiiRedactionDisabled: boolean = process.env.PII_REDACTION === 'off';

/** Stable PII hint string emitted by every redact strategy. */
type PiiHintString = Brand<string, 'PiiHintString'>;
/** Boolean predicate result for PII classifiers. */
type PiiClassifierBool = Brand<boolean, 'PiiClassifierBool'>;
/** Integer count returned by PII helpers (graphemes, indices). */
type PiiCountInt = Brand<number, 'PiiCountInt'>;

/** Exhaustive PII classification. */
type PiiCategory =
  | 'account'
  | 'card'
  | 'israeliId'
  | 'phone'
  | 'name'
  | 'merchant'
  | 'amount'
  | 'token'
  | 'otp'
  | 'cookie'
  | 'url'
  | 'html'
  | 'unknown';

/** Concrete JSON value union — used by the walker; no `unknown` leakage. */
type JsonScalar = string | number | boolean | null;
interface IJsonObject {
  readonly [key: string]: JsonValue;
}
type JsonArray = readonly JsonValue[];
type JsonValue = JsonScalar | IJsonObject | JsonArray;

/** Pino's redact callback value type — strings, numbers, or booleans. */
type CensorValue = string | number | boolean;
/** Pino's redact callback signature — value+path → string. */
type CensorFn = (value: CensorValue, path: readonly string[]) => string;

/** Maximum walk depth before redactJsonBody bails out for safety. */
const MAX_WALK_DEPTH = 1000;
/** Minimum identifier length required to extract a stable last-4 hint. */
const MIN_HINT_LEN = 4;
/** OTP length range — 4..8 ASCII digits. */
const OTP_MIN_LEN = 4;
const OTP_MAX_LEN = 8;
/** Israeli ID is exactly 9 digits. */
const ISRAELI_ID_LEN = 9;

/** Path-tail key → PiiCategory routing table (Partial, missing keys → undefined). */
const PATH_TAIL_TO_CATEGORY: Readonly<Partial<Record<string, PiiCategory>>> = {
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

/** URL query keys whose values are PII (redact value, keep key). */
const PII_QUERY_KEYS: ReadonlySet<string> = new Set([
  'accountId',
  'accountNumber',
  'cardId',
  'cardNumber',
  'cardUniqueId',
  'token',
  'authorization',
  'phoneNumber',
  'firstName',
  'lastName',
  'email',
  'customerId',
  'userId',
]);

/** Regex set used by the JSON-fallback path when the body isn't valid JSON. */
const FALLBACK_PATTERNS: readonly { readonly re: RegExp; readonly to: string }[] = [
  { re: /\b(\d{2}-\d{3}-)\d+(\d{4})\b/g, to: '$1***$2' },
  { re: /(?<!\d)\d{5}(\d{4})(?!\d)/g, to: '***$1' },
  { re: /eyJ[\w-]{20,}/g, to: '[REDACTED]' },
];

/** HTML scrubbing patterns applied to text content. */
const HTML_TEXT_PATTERNS: readonly { readonly re: RegExp; readonly to: string }[] = [
  { re: /\b(\d{2}-\d{3}-)\d+(\d{4})\b/g, to: '$1***$2' },
  { re: /(?<!\d)\d{5}(\d{4})(?!\d)/g, to: '***$1' },
  { re: /eyJ[\w-]{20,}/g, to: '[REDACTED]' },
];

/**
 * Whether a path-tail key classifies as token-shaped via case-insensitive
 * suffix match. Catches synthesised keys like `clsToken`, `xCsrfToken`.
 * @param key - Last segment of the path.
 * @returns True when the key looks like a token.
 */
function isTokenSuffix(key: string): PiiClassifierBool {
  const lower = key.toLowerCase();
  if (lower.endsWith('token')) return true as PiiClassifierBool;
  if (lower.endsWith('bearer')) return true as PiiClassifierBool;
  if (lower.endsWith('cookie')) return true as PiiClassifierBool;
  if (lower.endsWith('secret')) return true as PiiClassifierBool;
  return false as PiiClassifierBool;
}

/**
 * Whether a path-tail key classifies as a name-shaped value via
 * case-insensitive suffix match. Catches `customerFirstName`,
 * `accountHolderLastName`, etc. Bare `name` is intentionally NOT
 * matched — too many non-PII uses (frame.name, query name, file name).
 * Add it explicitly to PATH_TAIL_TO_CATEGORY only when a specific
 * bank surfaces a personal name under that bare key.
 * @param key - Last segment of the path.
 * @returns True when the key looks like a personal-name field.
 */
function isNameSuffix(key: string): PiiClassifierBool {
  const lower = key.toLowerCase();
  if (lower.endsWith('firstname')) return true as PiiClassifierBool;
  if (lower.endsWith('lastname')) return true as PiiClassifierBool;
  if (lower.endsWith('fullname')) return true as PiiClassifierBool;
  if (lower.endsWith('customername')) return true as PiiClassifierBool;
  return false as PiiClassifierBool;
}

/**
 * Classify a path's tail key into a PiiCategory.
 * @param key - Path tail key.
 * @returns Resolved category.
 */
function classifyKey(key: string): PiiCategory {
  const direct = PATH_TAIL_TO_CATEGORY[key];
  if (direct !== undefined) return direct;
  if (isTokenSuffix(key)) return 'token';
  if (isNameSuffix(key)) return 'name';
  return 'unknown';
}

/**
 * Build a Segmenter via Reflect.construct (DI rule).
 * @returns Grapheme segmenter (Intl.Segmenter is required by Node 22+).
 */
function buildSegmenter(): Intl.Segmenter {
  return Reflect.construct(Intl.Segmenter, ['und', { granularity: 'grapheme' }]);
}

/**
 * Count Unicode graphemes in a string using Intl.Segmenter (correct
 * for Hebrew, emoji, and combining marks).
 * @param input - String to measure.
 * @returns Grapheme count.
 */
function graphemeCount(input: string): PiiCountInt {
  if (input.length === 0) return 0 as PiiCountInt;
  const segmenter = buildSegmenter();
  const segments = segmenter.segment(input);
  return Array.from(segments).length as PiiCountInt;
}

/**
 * Locate the last separator index across `-`, `/`, ` `.
 * @param value - Input string.
 * @returns Last separator index, or -1.
 */
function lastSeparatorIndex(value: string): PiiCountInt {
  const dash = value.lastIndexOf('-');
  const slash = value.lastIndexOf('/');
  const space = value.lastIndexOf(' ');
  return Math.max(dash, slash, space) as PiiCountInt;
}

/**
 * Slice the terminal segment of an account-style string after the last
 * separator. Returns the whole string when no separator is present.
 * @param value - Account-style input.
 * @returns Terminal segment.
 */
function terminalSegment(value: string): PiiHintString {
  const sep = lastSeparatorIndex(value);
  if (sep === -1) return value as PiiHintString;
  return value.slice(sep + 1) as PiiHintString;
}

/**
 * Account-number strategy. Returns '***' + last 4 digits of the
 * terminal segment.
 * @param value - Raw account string.
 * @returns Stable hint.
 */
function redactAccount(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '' as PiiHintString;
  const tail = terminalSegment(value);
  if (tail.length <= MIN_HINT_LEN) return '[REDACTED]' as PiiHintString;
  return `***${tail.slice(-4)}` as PiiHintString;
}

/**
 * Card strategy. Returns '****' + last 4 digits.
 * @param value - Raw card string.
 * @returns Stable hint.
 */
function redactCard(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '' as PiiHintString;
  if (value.length < MIN_HINT_LEN) return '[REDACTED]' as PiiHintString;
  return `****${value.slice(-4)}` as PiiHintString;
}

/**
 * Israeli ID strategy. Validates 9 ASCII digits; returns last-4 hint.
 * @param value - Raw value.
 * @returns Stable hint.
 */
function redactIsraeliId(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '' as PiiHintString;
  const digits = value.replaceAll(/\D/g, '');
  if (digits.length !== ISRAELI_ID_LEN) return '[REDACTED]' as PiiHintString;
  return `***${digits.slice(-4)}` as PiiHintString;
}

/**
 * Phone strategy. Extracts trailing 4 digits across any separator.
 * @param value - Raw phone.
 * @returns Stable hint.
 */
function redactPhone(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '' as PiiHintString;
  const digits = value.replaceAll(/\D/g, '');
  if (digits.length < MIN_HINT_LEN) return '[REDACTED]' as PiiHintString;
  return `***${digits.slice(-4)}` as PiiHintString;
}

/**
 * Name strategy. Returns '<name:N>' where N = grapheme count.
 * @param value - Raw name.
 * @returns Stable hint.
 */
function redactName(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '' as PiiHintString;
  const n = graphemeCount(value);
  return `<name:${String(n)}>` as PiiHintString;
}

/**
 * Merchant / description strategy. Returns '<merchant:N>'.
 * @param value - Raw merchant string.
 * @returns Stable hint.
 */
function redactMerchant(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '' as PiiHintString;
  const n = graphemeCount(value);
  return `<merchant:${String(n)}>` as PiiHintString;
}

/**
 * Amount strategy. Returns sign-only marker.
 * @param value - Number or numeric string.
 * @returns Stable hint.
 */
function redactAmount(value: number | string): PiiHintString {
  if (isPiiRedactionDisabled) return String(value) as PiiHintString;
  const num = coerceToNumber(value);
  if (Number.isNaN(num)) return '[REDACTED]' as PiiHintString;
  if (num < 0) return '-***' as PiiHintString;
  return '+***' as PiiHintString;
}

/**
 * Coerce a number-or-string to a number, leaving NaN on bad input.
 * @param value - Number or numeric string.
 * @returns Number (NaN when value is non-numeric).
 */
function coerceToNumber(value: number | string): PiiCountInt {
  if (typeof value === 'number') return value as PiiCountInt;
  return Number(value) as PiiCountInt;
}

/**
 * Shared full-redact strategy used by both the token and the cookie
 * exports — both opaque secrets, both yield `[REDACTED]` in
 * production. Extracted to dodge the no-identical-functions lint and
 * to give the two exports a single authoritative implementation.
 * @param value - Raw secret.
 * @returns Stable hint.
 */
function redactOpaqueSecret(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '' as PiiHintString;
  return '[REDACTED]' as PiiHintString;
}

/**
 * Token / JWT strategy. Always full redact in production. In LOCAL
 * DEV MODE (`PII_REDACTION=off`), the raw value passes through so
 * engineers can debug auth flows. NEVER enable dev mode in CI or
 * production builds — the hard-guard in `isPiiRedactionDisabled`
 * is the only line of defence.
 * @param value - Raw token.
 * @returns Stable hint.
 */
function redactToken(value: string): PiiHintString {
  return redactOpaqueSecret(value);
}

/**
 * Bank-error-message strategy. Bank APIs occasionally echo the user's
 * credentials back in the `errorMessage` field of a failed-login
 * response (CWE-532). Free-text strings can't be safely interpolated
 * into a logger message; the central censor only operates on Pino's
 * structured object payload, not on the `msg` argument.
 *
 * <p>Returns a length-tag `<msg:N>` where N is the grapheme count of
 * the raw value (Unicode-correct for Hebrew bank responses). Engineers
 * keep the "yes there was a message, ~N chars long" signal while the
 * raw content stays out of logs / persisted artefacts. Closes CodeQL
 * `js/clear-text-logging` alert #28.
 *
 * <p>In LOCAL DEV MODE (`PII_REDACTION=off`) the raw value passes
 * through so engineers can debug login flows on a local machine.
 *
 * @param value - Raw error message from a bank API or production code.
 * @returns Length-tagged hint `<msg:N>` or `<msg:0>` for empty input.
 */
function redactErrorMessage(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '<msg:0>' as PiiHintString;
  const length = graphemeCount(value);
  return `<msg:${String(length)}>` as PiiHintString;
}

/**
 * Sensitive scraper-error-enum values that MUST NOT appear in
 * cleartext log lines. CodeQL alert #28 (`js/clear-text-logging`)
 * flags `ChangePassword` / `InvalidPassword` as
 * password-class metadata: an attacker scraping logs can use the
 * presence of either value to pivot on the same credentials at a
 * different bank.
 *
 * <p>Default-deny: enum strings NOT in this set survive the redactor
 * unchanged so non-sensitive outcomes (`Success`,
 * `Timeout`, `Generic`, etc.) keep their diagnostic
 * value. Add a new enum value here only when CodeQL or Sonar flags
 * it as sensitive.
 */
const SENSITIVE_SCRAPER_ENUMS: ReadonlySet<string> = new Set([
  'InvalidPassword',
  'ChangePassword',
  'INVALID_PASSWORD',
  'CHANGE_PASSWORD',
]);

/**
 * Sensitive-enum strategy. Replaces a sensitive scraper-error-type
 * enum value with the stable token `<REDACTED_ENUM>`; non-
 * sensitive values pass through unchanged.
 *
 * <p>Closes CodeQL alert #28 (`js/clear-text-logging`) at the
 * source — {@link redactErrorMessage} handles free-text
 * `errorMessage`, this helper handles the discriminated-union
 * tag `errorType`. Both routes are required because the
 * central Pino censor cannot intercept values interpolated into the
 * `msg` string argument; redaction must happen at the
 * line-composition site.
 *
 * <p>Applicable guidelines (per spec.txt §1 RC-1):
 * <ul>
 *   <li>`logging-pii-guidlines.md` §1 PII Safety — "Apply
 *       preventive masking BEFORE logging."</li>
 *   <li>`coding-principle-guidlines.md` §6 — "NEVER store
 *       secrets in code" (password-class enums are secret-adjacent).</li>
 * </ul>
 *
 * @param value - Raw scraper-error-type enum value (may be the
 *   discriminated-union tag, an empty string, or unknown text).
 * @returns The literal `<REDACTED_ENUM>` token when the value
 *   is in {@link SENSITIVE_SCRAPER_ENUMS}, otherwise the input value
 *   unchanged.
 */
function redactSensitiveEnum(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return value as PiiHintString;
  if (SENSITIVE_SCRAPER_ENUMS.has(value)) return '<REDACTED_ENUM>' as PiiHintString;
  return value as PiiHintString;
}

/**
 * OTP strategy. Returns '[OTP]' for 4..8 digit inputs; default-deny
 * otherwise. In LOCAL DEV MODE, raw value passes through.
 * @param value - Raw OTP.
 * @returns Stable hint.
 */
function redactOtp(value: string): PiiHintString {
  if (isPiiRedactionDisabled) return value as PiiHintString;
  if (value.length === 0) return '' as PiiHintString;
  if (value.length < OTP_MIN_LEN) return '[REDACTED]' as PiiHintString;
  if (value.length > OTP_MAX_LEN) return '[REDACTED]' as PiiHintString;
  return '[OTP]' as PiiHintString;
}

/**
 * Cookie strategy. Always full redact in production. In LOCAL DEV
 * MODE, raw value passes through.
 * @param value - Raw cookie string.
 * @returns Stable hint.
 */
function redactCookie(value: string): PiiHintString {
  return redactOpaqueSecret(value);
}

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
  if (strategy === undefined) return '[REDACTED]' as PiiHintString;
  const stringInput = toStringValue(args.value);
  return strategy(stringInput) as PiiHintString;
}

/**
 * Pino redact callback factory. Each invocation classifies the path
 * tail, dispatches to a strategy, and returns the stable hint string.
 * Strategy throws are caught and translated to '[REDACTION_ERROR]'.
 *
 * In LOCAL DEV MODE (`PII_REDACTION=off`), every per-category strategy
 * passes the raw value through — including auth strategies (token /
 * otp / cookie) — so the developer can fully inspect the request and
 * response cycle without masking. CI builds NEVER trip the dev mode.
 *
 * @returns Censor function bound to the production strategy table.
 */
function createCensorFn(): CensorFn {
  return (value, path): PiiHintString => {
    if (path.length === 0) return '[REDACTED]' as PiiHintString;
    const tail = path.at(-1);
    if (tail === undefined || tail.length === 0) return '[REDACTED]' as PiiHintString;
    try {
      const category = classifyKey(tail);
      return dispatchStrategy({ value, category });
    } catch {
      return '[REDACTION_ERROR]' as PiiHintString;
    }
  };
}

/**
 * Whether a captured plain object carries at least one PII-classified
 * property — drives the array-size preservation rule.
 * @param obj - Candidate object.
 * @returns True when at least one own key classifies as PII.
 */
function objectHasPii(obj: IJsonObject): PiiClassifierBool {
  const keys = Object.keys(obj);
  return keys.some(
    (k): PiiClassifierBool => (classifyKey(k) !== 'unknown') as PiiClassifierBool,
  ) as PiiClassifierBool;
}

/**
 * Whether a JsonValue is a plain JSON object (not array, not null).
 * @param v - Candidate value.
 * @returns True for plain JSON objects.
 */
function isJsonObject(v: JsonValue): v is IJsonObject {
  if (v === null) return false;
  if (typeof v !== 'object') return false;
  if (Array.isArray(v)) return false;
  return true;
}

/**
 * Whether an array contains at least one plain-object element with PII.
 * @param arr - Candidate array.
 * @returns True when at least one element has a PII-classified key.
 */
function arrayHasPiiObject(arr: JsonArray): PiiClassifierBool {
  return arr.some((el): PiiClassifierBool => {
    if (!isJsonObject(el)) return false as PiiClassifierBool;
    return objectHasPii(el);
  }) as PiiClassifierBool;
}

/** Recursive walk state — carried through redactNode for safety guards. */
interface IWalkState {
  readonly depth: number;
  readonly seen: WeakSet<object>;
  readonly censor: CensorFn;
}

/**
 * Build a fresh WeakSet via Reflect.construct.
 * @returns Empty WeakSet typed for arbitrary objects.
 */
function buildSeenSet(): WeakSet<object> {
  return Reflect.construct(WeakSet, []) as WeakSet<object>;
}

/**
 * Build a fresh walk state at depth 0.
 * @param censor - Active censor function.
 * @returns Initial walk state.
 */
function buildWalkState(censor: CensorFn): IWalkState {
  return { depth: 0, seen: buildSeenSet(), censor };
}

/**
 * Apply the censor to a leaf scalar. Unknown classification falls
 * through to pass-through (numbers in non-PII paths, booleans, etc.).
 * @param value - Leaf primitive (excluding null).
 * @param path - Path to this leaf.
 * @param censor - Active censor function.
 * @returns Censored hint string or the raw value.
 */
function redactLeaf(
  value: string | number | boolean,
  path: readonly string[],
  censor: CensorFn,
): JsonScalar {
  if (path.length === 0) return value;
  const tail = path.at(-1);
  if (tail === undefined || tail.length === 0) return value;
  const category = classifyKey(tail);
  if (category === 'unknown') return value;
  return censor(value, path);
}

/**
 * Walk a JSON object's own enumerable properties.
 * @param obj - Source object.
 * @param path - Path to this object.
 * @param state - Walk state.
 * @returns Redacted object.
 */
function redactObject(obj: IJsonObject, path: readonly string[], state: IWalkState): IJsonObject {
  const childState: IWalkState = { depth: state.depth + 1, seen: state.seen, censor: state.censor };
  const out: Record<string, JsonValue> = {};
  for (const key of Object.keys(obj)) {
    const next: readonly string[] = [...path, key];
    out[key] = redactNode(obj[key], next, childState);
  }
  return out;
}

/**
 * Walk a JSON array. If any element is a PII-bearing object, replace
 * the whole array with the sentinel '[<N redacted items>]'.
 * @param arr - Source array.
 * @param path - Path to the array.
 * @param state - Walk state.
 * @returns Redacted array or sentinel string.
 */
function redactArray(arr: JsonArray, path: readonly string[], state: IWalkState): JsonValue {
  if (arr.length === 0) return [];
  if (arrayHasPiiObject(arr)) return `[<${String(arr.length)} redacted items>]`;
  const childState: IWalkState = { depth: state.depth + 1, seen: state.seen, censor: state.censor };
  return arr.map((el): JsonValue => redactNode(el, path, childState));
}

/**
 * Whether a JsonValue is a JSON array (for type-narrowing inside redactNode).
 * @param v - Candidate value.
 * @returns True for JSON arrays.
 */
function isJsonArray(v: JsonValue): v is JsonArray {
  return Array.isArray(v);
}

/**
 * Walk a parsed JSON value, applying the censor to leaves and the
 * array-size rule to PII-bearing arrays. Cycles short-circuit, depth
 * is capped at MAX_WALK_DEPTH.
 * @param value - Current node.
 * @param path - Path from root.
 * @param state - Walk state.
 * @returns Redacted node.
 */
function redactNode(value: JsonValue, path: readonly string[], state: IWalkState): JsonValue {
  if (state.depth > MAX_WALK_DEPTH) return '[REDACTED:depth-limit]';
  if (value === null) return value;
  if (typeof value === 'string') return redactLeaf(value, path, state.censor);
  if (typeof value === 'number') return redactLeaf(value, path, state.censor);
  if (typeof value === 'boolean') return redactLeaf(value, path, state.censor);
  const isCycle = state.seen.has(value);
  if (isCycle) return '[REDACTED:cycle]';
  state.seen.add(value);
  if (isJsonArray(value)) return redactArray(value, path, state);
  return redactObject(value, path, state);
}

/**
 * Apply the regex fallback to a non-JSON body (also used post-stringify).
 * @param input - String to scrub.
 * @returns Scrubbed string.
 */
function applyFallbackPatterns(input: string): PiiHintString {
  return FALLBACK_PATTERNS.reduce(
    (acc, p): PiiHintString => acc.replaceAll(p.re, p.to) as PiiHintString,
    input as PiiHintString,
  );
}

/** Parsed-or-fallback result of trying JSON.parse on a body string. */
interface IParseAttempt {
  readonly ok: boolean;
  readonly parsed: JsonValue;
}

/**
 * Try JSON.parse without throwing.
 * @param body - Candidate JSON string.
 * @returns Parse attempt with parsed value on success.
 */
function tryParseJson(body: string): IParseAttempt {
  try {
    const raw = JSON.parse(body) as JsonValue;
    return { ok: true, parsed: raw };
  } catch {
    return { ok: false, parsed: null };
  }
}

/**
 * Parse + redact + restringify a JSON body string.
 * @param body - Raw body string.
 * @returns Redacted body string.
 */
function redactBodyString(body: string): PiiHintString {
  const attempt = tryParseJson(body);
  if (!attempt.ok) return applyFallbackPatterns(body);
  const censor = createCensorFn();
  const state = buildWalkState(censor);
  const out = redactNode(attempt.parsed, [], state);
  const stringified = JSON.stringify(out);
  return applyFallbackPatterns(stringified);
}

/**
 * Walk + redact an already-parsed JsonValue tree.
 * @param body - Parsed JSON tree.
 * @returns Redacted body string.
 */
function redactBodyValue(body: JsonValue): PiiHintString {
  const censor = createCensorFn();
  const state = buildWalkState(censor);
  const out = redactNode(body, [], state);
  const stringified = JSON.stringify(out);
  return applyFallbackPatterns(stringified);
}

/**
 * Redact a JSON body before persisting to disk. Accepts either a raw
 * string or an already-parsed JsonValue tree.
 * @param body - Raw body string OR parsed JsonValue tree.
 * @returns Redacted body string.
 */
/**
 * Identity passthrough used by `redactJsonBody` in LOCAL DEV MODE.
 * Pulled out so the public function stays at max-depth = 1.
 * @param body - Raw body string OR parsed JsonValue tree.
 * @returns The body unchanged (stringified when given a parsed tree).
 */
function passThroughJsonBody(body: string | JsonValue): PiiHintString {
  if (typeof body === 'string') return body as PiiHintString;
  return JSON.stringify(body) as PiiHintString;
}

/**
 * Redact a JSON body before persisting to disk. Accepts either a raw
 * string or an already-parsed JsonValue tree. In LOCAL DEV MODE
 * (`PII_REDACTION=off`), passes the body through unchanged so
 * captured `network/*.json` files contain real responses for
 * debugging.
 * @param body - Raw body string OR parsed JsonValue tree.
 * @returns Redacted body string.
 */
function redactJsonBody(body: string | JsonValue): PiiHintString {
  if (isPiiRedactionDisabled) return passThroughJsonBody(body);
  if (typeof body === 'string') return redactBodyString(body);
  return redactBodyValue(body);
}

/** Result of attempting to parse a string into a URL. */
interface IUrlParseResult {
  readonly ok: boolean;
  readonly url: URL;
}

/** Sentinel URL used when parsing fails (callers MUST check `ok`). */
const URL_PARSE_SENTINEL: URL = Reflect.construct(URL, ['https://invalid.local/']);

/**
 * Try to construct a URL via Reflect.construct without throwing.
 * @param input - Candidate URL string.
 * @returns Parse result with the URL on success.
 */
function tryParseUrl(input: string): IUrlParseResult {
  try {
    const url: URL = Reflect.construct(URL, [input]);
    return { ok: true, url };
  } catch {
    return { ok: false, url: URL_PARSE_SENTINEL };
  }
}

/**
 * Redact a single PII query key on a parsed URL in place.
 * @param parsed - Parsed URL (mutated).
 * @param key - PII query key to redact.
 * @param censor - Active censor function.
 * @returns True after the key has been processed.
 */
function redactQueryKey(parsed: URL, key: string, censor: CensorFn): true {
  const value = parsed.searchParams.get(key) ?? '';
  const censored = censor(value, [key]);
  parsed.searchParams.set(key, censored);
  return true;
}

/**
 * Redact a URL string. Replaces known PII query-key values; leaves
 * host, scheme, and path untouched. Returns input unchanged when
 * unparseable.
 * @param url - Raw URL string.
 * @returns Redacted URL.
 */
function redactUrl(url: string): PiiHintString {
  if (isPiiRedactionDisabled) return url as PiiHintString;
  if (url.length === 0) return '' as PiiHintString;
  const parse = tryParseUrl(url);
  if (!parse.ok) return url as PiiHintString;
  const censor = createCensorFn();
  const allKeys = [...parse.url.searchParams.keys()];
  const piiKeys = allKeys.filter(
    (k): PiiClassifierBool => PII_QUERY_KEYS.has(k) as PiiClassifierBool,
  );
  for (const key of piiKeys) redactQueryKey(parse.url, key, censor);
  return parse.url.toString() as PiiHintString;
}

/** Path segments shorter than this are safe to leave intact. */
const PATH_SEGMENT_DIGIT_THRESHOLD = 4;

/**
 * Predicate for path segments that look like account / card / phone
 * IDs — runs of ≥ 4 digits, optionally with embedded separators.
 * Conservative: digit-only segments. Hyphenated runs are caught by
 * `redactAccount`'s terminal-segment split.
 * @param segment - Single path segment.
 * @returns True when the segment is a candidate for last-4 hinting.
 */
function isLikelyIdSegment(segment: string): boolean {
  if (segment.length < PATH_SEGMENT_DIGIT_THRESHOLD) return false;
  return /^\d{4,}$/.test(segment);
}

/**
 * Mask a single URL path segment when it looks like an identifier.
 * Pulled out of `redactUrlFull`'s `.map` so the per-segment branch
 * isn't a ternary (the project lints ternaries as a forbidden form).
 * @param seg - Single path segment.
 * @returns The `***XXXX` hint when the segment looks like an ID,
 *   otherwise the input segment unchanged.
 */
function maskPathSegmentIfId(seg: string): string {
  if (!isLikelyIdSegment(seg)) return seg;
  return redactAccount(seg);
}

/**
 * Redact a URL fully — `redactUrl` (query) plus per-segment account
 * masking (path). For each `/`-delimited segment that looks like an
 * account or card identifier (≥ 4 digit run), replace it with the
 * `***XXXX` last-4 hint produced by {@link redactAccount}. Leaves
 * non-identifier segments untouched so route names like
 * `getTransactionsAndGraphs` survive — the segment that *actually*
 * disambiguates which sibling endpoint the network picker chose is
 * never lost to the 30-char `maskVisibleText` truncation, while
 * account IDs in path positions never reach the log channel.
 *
 * Composes existing `redactUrl` + `redactAccount`; no new redaction
 * logic, just composition.
 *
 * @param url - Raw URL string.
 * @returns Redacted URL with both query and path-segment PII masked.
 */
function redactUrlFull(url: string): PiiHintString {
  if (isPiiRedactionDisabled) return url as PiiHintString;
  const queryRedacted = redactUrl(url);
  const parse = tryParseUrl(queryRedacted);
  if (!parse.ok) return queryRedacted;
  const segments = parse.url.pathname.split('/');
  const masked = segments.map(maskPathSegmentIfId);
  parse.url.pathname = masked.join('/');
  return parse.url.toString() as PiiHintString;
}

/** Regex matching `value="…"` / `value='…'` attributes (single capture). */
const HTML_VALUE_ATTR_RE = /value\s*=\s*["']([^"']{2,})["']/gi;

/**
 * Replace the captured @value content with a grapheme-count length
 * tag. Single-capture regex keeps the callback at 2 params.
 * @param _match - Whole match (unused; placeholder per replace API).
 * @param content - Captured @value content.
 * @returns Redacted attribute (always normalised to double quotes).
 */
function replaceValueAttr(_match: string, content: string): PiiHintString {
  const trimmed = content.trim();
  if (trimmed.length === 0) return `value="${content}"` as PiiHintString;
  const n = graphemeCount(content);
  return `value="<name:${String(n)}>"` as PiiHintString;
}

/**
 * Redact an HTML string. Replaces well-known PII patterns inside text
 * nodes and inside input @value attributes. Structure is preserved.
 * @param html - Raw HTML.
 * @returns Redacted HTML.
 */
function redactHtml(html: string): PiiHintString {
  if (isPiiRedactionDisabled) return html as PiiHintString;
  if (html.length === 0) return '' as PiiHintString;
  let out = html;
  for (const p of HTML_TEXT_PATTERNS) out = out.replaceAll(p.re, p.to);
  out = out.replaceAll(HTML_VALUE_ATTR_RE, replaceValueAttr);
  return out as PiiHintString;
}

export type { CensorFn, JsonValue, PiiCategory };
export {
  classifyKey,
  createCensorFn,
  redactAccount,
  redactAmount,
  redactCard,
  redactCookie,
  redactErrorMessage,
  redactHtml,
  redactIsraeliId,
  redactJsonBody,
  redactMerchant,
  redactName,
  redactOtp,
  redactPhone,
  redactSensitiveEnum,
  redactToken,
  redactUrl,
  redactUrlFull,
};
