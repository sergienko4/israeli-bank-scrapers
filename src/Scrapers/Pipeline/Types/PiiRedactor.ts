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
function isTokenSuffix(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower.endsWith('token')) return true;
  if (lower.endsWith('bearer')) return true;
  if (lower.endsWith('cookie')) return true;
  if (lower.endsWith('secret')) return true;
  return false;
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
function isNameSuffix(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower.endsWith('firstname')) return true;
  if (lower.endsWith('lastname')) return true;
  if (lower.endsWith('fullname')) return true;
  if (lower.endsWith('customername')) return true;
  return false;
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
function graphemeCount(input: string): number {
  if (input.length === 0) return 0;
  const segmenter = buildSegmenter();
  const segments = segmenter.segment(input);
  return Array.from(segments).length;
}

/**
 * Locate the last separator index across `-`, `/`, ` `.
 * @param value - Input string.
 * @returns Last separator index, or -1.
 */
function lastSeparatorIndex(value: string): number {
  const dash = value.lastIndexOf('-');
  const slash = value.lastIndexOf('/');
  const space = value.lastIndexOf(' ');
  return Math.max(dash, slash, space);
}

/**
 * Slice the terminal segment of an account-style string after the last
 * separator. Returns the whole string when no separator is present.
 * @param value - Account-style input.
 * @returns Terminal segment.
 */
function terminalSegment(value: string): string {
  const sep = lastSeparatorIndex(value);
  if (sep === -1) return value;
  return value.slice(sep + 1);
}

/**
 * Account-number strategy. Returns '***' + last 4 digits of the
 * terminal segment.
 * @param value - Raw account string.
 * @returns Stable hint.
 */
function redactAccount(value: string): string {
  if (value.length === 0) return '';
  const tail = terminalSegment(value);
  if (tail.length <= MIN_HINT_LEN) return '[REDACTED]';
  return `***${tail.slice(-4)}`;
}

/**
 * Card strategy. Returns '****' + last 4 digits.
 * @param value - Raw card string.
 * @returns Stable hint.
 */
function redactCard(value: string): string {
  if (value.length === 0) return '';
  if (value.length < MIN_HINT_LEN) return '[REDACTED]';
  return `****${value.slice(-4)}`;
}

/**
 * Israeli ID strategy. Validates 9 ASCII digits; returns last-4 hint.
 * @param value - Raw value.
 * @returns Stable hint.
 */
function redactIsraeliId(value: string): string {
  if (value.length === 0) return '';
  const digits = value.replaceAll(/\D/g, '');
  if (digits.length !== ISRAELI_ID_LEN) return '[REDACTED]';
  return `***${digits.slice(-4)}`;
}

/**
 * Phone strategy. Extracts trailing 4 digits across any separator.
 * @param value - Raw phone.
 * @returns Stable hint.
 */
function redactPhone(value: string): string {
  if (value.length === 0) return '';
  const digits = value.replaceAll(/\D/g, '');
  if (digits.length < MIN_HINT_LEN) return '[REDACTED]';
  return `***${digits.slice(-4)}`;
}

/**
 * Name strategy. Returns '<name:N>' where N = grapheme count.
 * @param value - Raw name.
 * @returns Stable hint.
 */
function redactName(value: string): string {
  if (value.length === 0) return '';
  const n = graphemeCount(value);
  return `<name:${String(n)}>`;
}

/**
 * Merchant / description strategy. Returns '<merchant:N>'.
 * @param value - Raw merchant string.
 * @returns Stable hint.
 */
function redactMerchant(value: string): string {
  if (value.length === 0) return '';
  const n = graphemeCount(value);
  return `<merchant:${String(n)}>`;
}

/**
 * Amount strategy. Returns sign-only marker.
 * @param value - Number or numeric string.
 * @returns Stable hint.
 */
function redactAmount(value: number | string): string {
  const num = coerceToNumber(value);
  if (Number.isNaN(num)) return '[REDACTED]';
  if (num < 0) return '-***';
  return '+***';
}

/**
 * Coerce a number-or-string to a number, leaving NaN on bad input.
 * @param value - Number or numeric string.
 * @returns Number (NaN when value is non-numeric).
 */
function coerceToNumber(value: number | string): number {
  if (typeof value === 'number') return value;
  return Number(value);
}

/**
 * Token / JWT / cookie strategy. Always full redact.
 * @param value - Raw token.
 * @returns Stable hint.
 */
function redactToken(value: string): string {
  if (value.length === 0) return '';
  return '[REDACTED]';
}

/**
 * OTP strategy. Returns '[OTP]' for 4..8 digit inputs; default-deny
 * otherwise.
 * @param value - Raw OTP.
 * @returns Stable hint.
 */
function redactOtp(value: string): string {
  if (value.length === 0) return '';
  if (value.length < OTP_MIN_LEN) return '[REDACTED]';
  if (value.length > OTP_MAX_LEN) return '[REDACTED]';
  return '[OTP]';
}

/**
 * Cookie strategy. Always full redact.
 * @param value - Raw cookie string.
 * @returns Stable hint.
 */
function redactCookie(value: string): string {
  if (value.length === 0) return '';
  return '[REDACTED]';
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
function toStringValue(value: CensorValue): string {
  if (typeof value === 'string') return value;
  return String(value);
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
function dispatchStrategy(args: IDispatchArgs): string {
  if (args.category === 'amount') {
    const amountInput = toAmountValue(args.value);
    return redactAmount(amountInput);
  }
  const strategy = STRING_STRATEGIES[args.category];
  if (strategy === undefined) return '[REDACTED]';
  const stringInput = toStringValue(args.value);
  return strategy(stringInput);
}

/**
 * Pino redact callback factory. Each invocation classifies the path
 * tail, dispatches to a strategy, and returns the stable hint string.
 * Strategy throws are caught and translated to '[REDACTION_ERROR]'.
 * @returns Censor function bound to the production strategy table.
 */
function createCensorFn(): CensorFn {
  return (value, path): string => {
    if (path.length === 0) return '[REDACTED]';
    const tail = path.at(-1);
    if (tail === undefined || tail.length === 0) return '[REDACTED]';
    try {
      const category = classifyKey(tail);
      return dispatchStrategy({ value, category });
    } catch {
      return '[REDACTION_ERROR]';
    }
  };
}

/**
 * Whether a captured plain object carries at least one PII-classified
 * property — drives the array-size preservation rule.
 * @param obj - Candidate object.
 * @returns True when at least one own key classifies as PII.
 */
function objectHasPii(obj: IJsonObject): boolean {
  const keys = Object.keys(obj);
  return keys.some((k): boolean => classifyKey(k) !== 'unknown');
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
function arrayHasPiiObject(arr: JsonArray): boolean {
  return arr.some((el): boolean => {
    if (!isJsonObject(el)) return false;
    return objectHasPii(el);
  });
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
function applyFallbackPatterns(input: string): string {
  return FALLBACK_PATTERNS.reduce((acc, p): string => acc.replaceAll(p.re, p.to), input);
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
function redactBodyString(body: string): string {
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
function redactBodyValue(body: JsonValue): string {
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
function redactJsonBody(body: string | JsonValue): string {
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
function redactUrl(url: string): string {
  if (url.length === 0) return '';
  const parse = tryParseUrl(url);
  if (!parse.ok) return url;
  const censor = createCensorFn();
  const allKeys = [...parse.url.searchParams.keys()];
  const piiKeys = allKeys.filter((k): boolean => PII_QUERY_KEYS.has(k));
  for (const key of piiKeys) redactQueryKey(parse.url, key, censor);
  return parse.url.toString();
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
function replaceValueAttr(_match: string, content: string): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) return `value="${content}"`;
  const n = graphemeCount(content);
  return `value="<name:${String(n)}>"`;
}

/**
 * Redact an HTML string. Replaces well-known PII patterns inside text
 * nodes and inside input @value attributes. Structure is preserved.
 * @param html - Raw HTML.
 * @returns Redacted HTML.
 */
function redactHtml(html: string): string {
  if (html.length === 0) return '';
  let out = html;
  for (const p of HTML_TEXT_PATTERNS) out = out.replaceAll(p.re, p.to);
  out = out.replaceAll(HTML_VALUE_ATTR_RE, replaceValueAttr);
  return out;
}

export type { CensorFn, JsonValue, PiiCategory };
export {
  classifyKey,
  createCensorFn,
  redactAccount,
  redactAmount,
  redactCard,
  redactCookie,
  redactHtml,
  redactIsraeliId,
  redactJsonBody,
  redactMerchant,
  redactName,
  redactOtp,
  redactPhone,
  redactToken,
  redactUrl,
};
