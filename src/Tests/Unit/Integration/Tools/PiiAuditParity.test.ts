/**
 * Parity between the fixture redactor and the `fixtures-pii` audit gate
 * (`scripts/audit-fixtures-pii.cjs`).
 *
 * The invariant: the gate flags every raw value the redactor rewrites, with
 * the rule that mirrors it, and passes the redacted output; it never flags a
 * look-alike the redactor leaves alone. Both sides share one zero policy
 * (ZERO_MATCH_CASES): a value with no non-zero digit is not personal data,
 * so the redactor keeps it and the gate passes it. Zeroed and NDJSON-escaped
 * variants of every positive row are checked for the same drift. The only
 * deliberate asymmetries, the gate's context exemptions, are pinned one per
 * exemption in CONTEXT_EXEMPT_CASES. An exemption can hide a raw match
 * the gate should never make, so the radware rule is also pinned on its
 * raw matches, the same list for both regexes (RADWARE_MATCH_CASES): a
 * drift in either regex fails the suite even while the exemption masks the
 * hit. When either side drifts, this suite fails, so the gate can't stay
 * red on text the redactor won't touch, or pass PII the redactor would
 * have caught.
 */

import {
  type AuditHit,
  auditText,
  RULE_IDS,
  ruleRegex,
} from '../../../../../scripts/audit-fixtures-pii.cjs';
import {
  PII_PATTERNS,
  PII_REPLACEMENTS,
  type PiiPatternKey,
  redactPii,
} from '../../../Integration/Tools/PiiRedactor.js';
import {
  NEGATIVE_CASES as BANK_NEGATIVE,
  POSITIVE_CASES as BANK_POSITIVE,
  RADWARE_MATCH_CASES,
} from './PiiBankShapeCases.js';
import {
  CONTEXT_EXEMPT_CASES,
  CORE_NEGATIVE_CASES,
  CORE_POSITIVE_CASES,
} from './PiiCoreShapeCases.js';

/** Every exact-output row. */
const POSITIVE_CASES = [...BANK_POSITIVE, ...CORE_POSITIVE_CASES];
/** Every look-alike row. */
const NEGATIVE_CASES = [...BANK_NEGATIVE, ...CORE_NEGATIVE_CASES];

/** A rule and a text, without an expected output. */
interface IRuleText {
  readonly key: PiiPatternKey;
  readonly input: string;
}

/**
 * A positive row with every non-zero digit turned to `0`.
 *
 * @param row - A positive row.
 * @returns The same rule over the all-zero text.
 */
function zeroed(row: IRuleText): IRuleText {
  return { key: row.key, input: row.input.replace(/[1-9]/g, '0') };
}

/** Every positive row with a non-zero digit, zeroed: a drift fuzz, since
 *  zeroing structural digits can stop a row matching its own rule. */
const ZEROED_CASES = POSITIVE_CASES.filter(row => /[1-9]/.test(row.input)).map(zeroed);

/**
 * A positive row as an NDJSON trace stores it: every double quote escaped.
 *
 * @param row - A positive row.
 * @returns The same rule over the escaped text.
 */
function escapedQuotes(row: IRuleText): IRuleText {
  return { key: row.key, input: row.input.replaceAll('"', String.raw`\"`) };
}

/** Every positive row with a bare double quote, NDJSON-escaped. */
const ESCAPED_CASES = POSITIVE_CASES.filter(
  row => row.input.includes('"') && !row.input.includes(String.raw`\"`),
).map(escapedQuotes);

/**
 * A positive row with only its own rule's matches zeroed. A shape with a
 * structural non-zero digit (`05x` phones, `</h1>`) then stops matching, and
 * both sides must agree it is no longer PII.
 *
 * @param row - A positive row.
 * @returns The same rule over the text with its matched values zeroed.
 */
function zeroMatches(row: IRuleText): IRuleText {
  const input = row.input.replace(PII_PATTERNS[row.key], match => match.replace(/[1-9]/g, '0'));
  return { key: row.key, input };
}

/** Every positive row, only its own rule's values zeroed: each rule's zero
 *  policy is derived per row, so no hand-kept list of rules can drift. */
const ZERO_MATCH_CASES = POSITIVE_CASES.map(zeroMatches);

/** The gate rule that mirrors each redactor rule the shared cases pin. */
const GATE_RULE_FOR: Partial<Record<PiiPatternKey, string>> = {
  recaptchaTokenInput: 'recaptcha-token',
  bearerToken: 'bearer-token',
  jwtToken: 'jwt',
  lsessionIdParam: 'lsessionid-token',
  trackingIdParam: 'tracking-id-param',
  trackingIdInAssetPath: 'tracking-id-asset-path',
  trackingMidInAssetPath: 'tracking-mid-asset-path',
  trackingSidInAssetPath: 'tracking-sid-asset-path',
  hebrewGreetingName: 'hebrew-greeting-name',
  urlPathAccountId: 'bare-account-in-url',
  lastLoginText: 'last-login-text',
  numericBalanceSpan: 'numeric-balance-span',
  jsonMonetaryField: 'json-monetary-field',
  jsonAccountNumberField: 'json-account-number',
  ilIban: 'il-iban',
  ilBankAccount: 'il-bank-account',
  hapoalimBranchAccount: 'hapoalim-branch-account',
  israeliId9: 'israeli-id-9',
  israeliPhone: 'israeli-mobile',
  israeliLandline: 'israeli-landline',
  email: 'email',
  ilsAmount: 'ils-prefix-amount',
  ilsAmountSuffix: 'ils-suffix-amount',
  telLinkRedactedHref: 'tel-link-redacted-id',
  telLinkRedactedIdHref: 'tel-link-redacted-id',
  base64EmbeddedIp: 'b64-embedded-ip',
  clientIpField: 'client-ip-field',
  radwareSessionUuid: 'radware-session-uuid',
  requestVerificationToken: 'request-verification-token',
  cookieAuthValue: 'cookie-auth',
  jsonTokenField: 'json-token-field',
  jsonActionGuid: 'json-action-guid',
  hebrewLastLoginLabel: 'hebrew-last-login-label',
  jsonLastLoginField: 'json-last-login',
  mizNumericText: 'miz-numeric-text',
  mizNumericAttr: 'miz-numeric-attr',
  currencyAmountAttr: 'currency-amount-attr',
  mizrahiReferenceCell: 'miz-reference-cell',
  jsonTranslitMoneyNumber: 'json-translit-money',
  jsonTranslitMoneyString: 'json-translit-money',
  jsonMizrahiReference: 'json-mizrahi-reference',
  jsonBranchField: 'json-branch-field',
  branchBeforeRedactedAccount: 'branch-before-redacted-account',
  jsonPersonNameField: 'json-person-name-field',
  jsonOpaqueUserIdField: 'json-opaque-user-id',
  glassboxUserIdAttr: 'glassbox-user-id',
  roleEmbeddedAccount: 'role-embedded-account',
};

/** Mirrored rules that match operator literals from the gitignored
 *  `.pii-secrets.json`, so no committed synthetic case can pin them. */
const SECRET_LITERAL_RULE_FOR: Partial<Record<PiiPatternKey, string>> = {
  hebrewSurnameLiteral: 'hebrew-name-literal-surname',
  hebrewGivenNameLiteral: 'hebrew-name-literal-given',
  englishOperatorName: 'eng-name-literal',
  operatorUsername: 'username-literal',
  operatorAccountLiteral: 'operator-account-literal',
};

/** Redactor rules with no gate mirror, and why. */
const REDACTOR_ONLY: Partial<Record<PiiPatternKey, string>> = {
  recaptchaAnchorInit: 'a reCAPTCHA challenge payload, not personal data',
};

/** Gate rules with no redactor rule, and why. */
const GATE_ONLY: Readonly<Record<string, string>> = {
  'card-full-16': 'detect-only: a card number needs a manual fix',
  'card-masked-last4': 'detect-only: a card suffix needs a manual fix',
  'prettier-corrupt-redacted-id': 'flags a formatter-corrupted placeholder',
  'redacted-marker-name': 'INFO count of a placeholder',
  'redacted-marker-account': 'INFO count of a placeholder',
  'redacted-marker-amount': 'INFO count of a placeholder',
  'redacted-marker-id': 'INFO count of a placeholder',
  'redacted-marker-unique-id': 'INFO count of a placeholder',
};

/** Every redactor rule the gate mirrors with synthetic cases. */
const MIRRORED_KEYS = Object.keys(GATE_RULE_FOR) as PiiPatternKey[];
/** Every rule a shared case row is aimed at. */
const CASE_KEYS = [...POSITIVE_CASES, ...NEGATIVE_CASES].map(row => row.key);

/** Both sides of the Radware rule, as raw patterns: the gate exempts a
 *  match that holds no raw UUID, so only its raw pattern shows the gate
 *  still matching a value with no UUID in it. */
const RADWARE_SIDES = [
  ['redactor', PII_PATTERNS.radwareSessionUuid],
  ['gate', ruleRegex('radware-session-uuid')],
] as const;

/** Every Radware raw-match row, once per side. */
const RADWARE_SIDE_CASES = RADWARE_SIDES.flatMap(([side, pattern]) =>
  RADWARE_MATCH_CASES.map(row => ({ side, pattern, ...row })),
);

/**
 * The gate rules that fail on a text, ignoring INFO placeholder markers.
 *
 * @param text - Fixture-shaped text.
 * @returns Ids of every CRITICAL or HIGH rule that fired.
 */
function failingRules(text: string): string[] {
  const hits = auditText(text).filter(hit => hit.pat.severity !== 'INFO');
  return hits.map(hit => hit.pat.id);
}

/**
 * Whether a redactor rule changes the text at one of its matches; a match
 * that is already its own placeholder (`xauth=[redacted-cookie]`) is not.
 *
 * @param key - Redactor rule.
 * @param text - Fixture-shaped text.
 * @param start - Offset of the match.
 * @returns True when the rule rewrites that match.
 */
function rewritesAt(key: PiiPatternKey, text: string, start: number): boolean {
  const pattern = PII_PATTERNS[key];
  const sticky = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}y`);
  sticky.lastIndex = start;
  const replacement = PII_REPLACEMENTS[key];
  if (typeof replacement === 'function') return text.replace(sticky, replacement) !== text;
  return text.replace(sticky, replacement) !== text;
}

/**
 * Whether any gate hit overlaps a span of the text.
 *
 * @param hits - Gate hits.
 * @param span - A regex match in the same text.
 * @returns True when a hit covers part of the span.
 */
function isCovered(hits: readonly AuditHit[], span: RegExpExecArray): boolean {
  const end = span.index + span[0].length;
  return hits.some(hit => hit.at < end && span.index < hit.at + hit.match.length);
}

/**
 * Every raw span a redactor rule rewrites in a text.
 *
 * @param key - Redactor rule.
 * @param text - Fixture-shaped text.
 * @returns The matches the rule changes.
 */
function rewrittenSpans(key: PiiPatternKey, text: string): RegExpExecArray[] {
  const spans = [...text.matchAll(PII_PATTERNS[key])];
  return spans.filter(span => rewritesAt(key, text, span.index));
}

/**
 * Start offsets of every raw span a redactor rule rewrites that no gate hit
 * of its mirror rule overlaps, so a gate that flags only one of several raw
 * values in a text still fails.
 *
 * @param key - Redactor rule.
 * @param text - Fixture-shaped text.
 * @returns Offsets of the raw spans the mirror rule missed.
 */
function unflaggedSpans(key: PiiPatternKey, text: string): number[] {
  const hits = auditText(text).filter(hit => hit.pat.id === GATE_RULE_FOR[key]);
  const missed = rewrittenSpans(key, text).filter(span => !isCovered(hits, span));
  return missed.map(span => span.index);
}

describe('fixtures-pii gate parity with PiiRedactor', () => {
  it('classifies every redactor rule exactly once', () => {
    const groups = [GATE_RULE_FOR, SECRET_LITERAL_RULE_FOR, REDACTOR_ONLY];
    const classified = groups.flatMap(group => Object.keys(group)).sort();
    const redactorKeys = Object.keys(PII_PATTERNS).sort();
    expect(classified).toEqual(redactorKeys);
  });

  it('accounts for every gate rule', () => {
    const groups = [GATE_RULE_FOR, SECRET_LITERAL_RULE_FOR];
    const mirrors = groups.flatMap(group => Object.values(group));
    const accounted = new Set([...mirrors, ...Object.keys(GATE_ONLY)]);
    const sortedAccounted = [...accounted].sort();
    const gateIds = [...RULE_IDS].sort();
    expect(sortedAccounted).toEqual(gateIds);
  });

  it.each(MIRRORED_KEYS)('pins %s with a positive and a negative case', key => {
    const hasPositive = POSITIVE_CASES.some(row => row.key === key);
    const hasNegative = NEGATIVE_CASES.some(row => row.key === key);
    expect({ hasPositive, hasNegative }).toEqual({ hasPositive: true, hasNegative: true });
  });

  it('maps every case row to its gate mirror', () => {
    const unmapped = CASE_KEYS.filter(key => !(key in GATE_RULE_FOR));
    expect(unmapped).toEqual([]);
  });

  it.each(POSITIVE_CASES)('flags a raw $key shape with its mirror rule', row => {
    const mirror = GATE_RULE_FOR[row.key];
    const fired = failingRules(row.input);
    expect(fired).toContain(mirror);
  });

  it.each(POSITIVE_CASES)('rewrites at least one raw $key value', row => {
    const rewritten = rewrittenSpans(row.key, row.input);
    expect(rewritten.length).toBeGreaterThan(0);
  });

  it.each(POSITIVE_CASES)('flags every raw $key value the redactor rewrites', row => {
    const missed = unflaggedSpans(row.key, row.input);
    expect(missed).toEqual([]);
  });

  it.each(ZEROED_CASES)('flags every raw $key value in a zeroed shape', row => {
    const missed = unflaggedSpans(row.key, row.input);
    expect(missed).toEqual([]);
  });

  it.each(ZEROED_CASES)('passes the redacted zeroed $key shape', row => {
    const redacted = redactPii(row.input);
    const fired = failingRules(redacted);
    expect(fired).toEqual([]);
  });

  it.each(ESCAPED_CASES)('flags every raw $key value in an escaped shape', row => {
    const missed = unflaggedSpans(row.key, row.input);
    expect(missed).toEqual([]);
  });

  it.each(ESCAPED_CASES)('passes the redacted escaped $key shape', row => {
    const redacted = redactPii(row.input);
    const fired = failingRules(redacted);
    expect(fired).toEqual([]);
  });

  it.each(ZERO_MATCH_CASES)('flags a zeroed $key value only where it rewrites it', row => {
    const isRewritten = rewrittenSpans(row.key, row.input).length > 0;
    const mirror = GATE_RULE_FOR[row.key];
    const isFlagged = auditText(row.input).some(hit => hit.pat.id === mirror);
    const missed = unflaggedSpans(row.key, row.input);
    expect({ isFlagged, missed }).toEqual({ isFlagged: isRewritten, missed: [] });
  });

  it.each(CONTEXT_EXEMPT_CASES)('rewrites a $reason the gate exempts ($key)', row => {
    const rewritten = rewrittenSpans(row.key, row.input).length;
    const fired = failingRules(row.input);
    expect({ rewritten: rewritten > 0, fired }).toEqual({ rewritten: true, fired: [] });
  });

  it.each(RADWARE_SIDE_CASES)('$side radware rule matches $matches in $input', row => {
    const matched = [...row.input.matchAll(row.pattern)].map(match => match[0]);
    expect(matched).toEqual(row.matches);
  });

  it('rejects a rule id the gate does not define', () => {
    expect((): RegExp => ruleRegex('missing-rule')).toThrow(
      'unknown fixtures-pii rule: missing-rule',
    );
  });

  it.each(POSITIVE_CASES)('passes the redacted $key shape', row => {
    const redacted = redactPii(row.input);
    const fired = failingRules(redacted);
    expect(fired).toEqual([]);
  });

  it.each(NEGATIVE_CASES)('never flags a $key look-alike', row => {
    const fired = failingRules(row.input);
    expect(fired).toEqual([]);
  });
});
