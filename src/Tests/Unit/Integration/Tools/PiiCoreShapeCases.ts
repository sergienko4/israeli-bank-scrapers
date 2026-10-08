/**
 * Shared cases for the PiiRedactor core rules every bank shares: tokens,
 * tracking ids, greetings, last-login stamps, account numbers, IBANs, ids,
 * phones, emails, amounts and the `tel:` placeholder clean-up.
 *
 * Read with `PiiBankShapeCases.ts` by the exact-output suite and the
 * `fixtures-pii` audit gate parity suite. Every value is synthetic.
 */

import type { PiiPatternKey } from '../../../Integration/Tools/PiiRedactor.js';
import { type IShapeCase, unchanged } from './PiiBankShapeCases.js';

/** A synthetic JWT: three base64url segments. */
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGljLXNpZ25hdHVyZQ';

/** Core shapes each rule must rewrite, with the full expected output. */
export const CORE_POSITIVE_CASES: readonly IShapeCase[] = [
  {
    key: 'recaptchaTokenInput',
    input: '<input type="hidden" id="recaptcha-token" value="03AFcWeA5synthetic">',
    expected: '<input type="hidden" id="recaptcha-token" value="REDACTED_RECAPTCHA_TOKEN">',
  },
  {
    key: 'recaptchaTokenInput',
    input: '<input id="recaptcha-token" value="REDACTED_03AFcWeA5">',
    expected: '<input id="recaptcha-token" value="REDACTED_RECAPTCHA_TOKEN">',
  },
  {
    key: 'bearerToken',
    input: 'Authorization: Bearer abcDEF123456ghiJKL789xyz',
    expected: 'Authorization: Bearer [redacted-bearer]',
  },
  { key: 'jwtToken', input: `{"t":"${JWT}"}`, expected: '{"t":"[redacted-jwt]"}' },
  {
    key: 'lsessionIdParam',
    input: '<img src="https://t.example/p?a=1&LSESSIONID=AbC123xyz456def&b=2">',
    expected: '<img src="https://t.example/p?a=1&LSESSIONID=REDACTED_SESSION_ID&b=2">',
  },
  {
    key: 'lsessionIdParam',
    input: '?LSESSIONID=REDACTED_a1b2c3&x=1',
    expected: '?LSESSIONID=REDACTED_SESSION_ID&x=1',
  },
  {
    key: 'trackingIdParam',
    input: 'https://bat.example/action/0?ti=12345678&Ver=2',
    expected: 'https://bat.example/action/0?ti=REDACTED_TRACKING_ID&Ver=2',
  },
  {
    key: 'trackingIdInAssetPath',
    input: '/assets/clarity_tag_uet_12345678.js',
    expected: '/assets/clarity_tag_uet_REDACTED_TRACKING_ID.js',
  },
  {
    key: 'trackingMidInAssetPath',
    input: '/a_mid_1b2c3d4e-aaaa-4bbb-8ccc-abcdefabcdef.js',
    expected: '/a_mid_REDACTED_SESSION_UUID.js',
  },
  {
    key: 'trackingSidInAssetPath',
    input: '/a_sid_0123456789abcdef.js',
    expected: '/a_sid_REDACTED_SESSION_HEX.js',
  },
  {
    key: 'hebrewGreetingName',
    input: '<h1>שלום</h1><p class="n">ישראל ישראלי</p>',
    expected: '<h1>שלום</h1><p class="n">[redacted-name]</p>',
  },
  {
    key: 'hebrewGreetingName',
    input: '<h1>שלום</h1><p>ישראל [redacted-name]</p>',
    expected: '<h1>שלום</h1><p>[redacted-name]</p>',
  },
  {
    key: 'urlPathAccountId',
    input: '{"url":"/api/accounts/balance/12345678"}',
    expected: '{"url":"/api/accounts/balance/[redacted-account]"}',
  },
  {
    key: 'lastLoginText',
    input: '<span class="last-login">Last visit 07/10/26 10:15</span>',
    expected: '<span class="last-login">[redacted-last-login]</span>',
  },
  {
    key: 'lastLoginText',
    input:
      '<span class="last-login">[redacted-last-login]</span><span class="last-login">07/10/26 10:15</span>',
    expected:
      '<span class="last-login">[redacted-last-login]</span><span class="last-login">[redacted-last-login]</span>',
  },
  {
    key: 'numericBalanceSpan',
    input: '<span class="number-positive">1,234.50</span>',
    expected: '<span class="number-positive">[redacted-amount]</span>',
  },
  {
    key: 'jsonMonetaryField',
    input: '{"currentBalance": 1234.5}',
    expected: '{"currentBalance": 0}',
  },
  {
    key: 'jsonMonetaryField',
    input: String.raw`{\"currentBalance\":123.45}`,
    expected: String.raw`{\"currentBalance\":0}`,
  },
  {
    key: 'jsonAccountNumberField',
    input: '{"accountNumber": 4567123}',
    expected: '{"accountNumber": 0}',
  },
  { key: 'ilIban', input: 'IBAN IL620108000000099999999', expected: 'IBAN [redacted-iban]' },
  { key: 'ilBankAccount', input: 'acct 12-345-678901', expected: 'acct [redacted-account]' },
  { key: 'ilBankAccount', input: 'acct 000-000-1234567', expected: 'acct [redacted-account]' },
  {
    key: 'hapoalimBranchAccount',
    input: 'חשבון 612 345678',
    expected: 'חשבון [redacted-account]',
  },
  { key: 'israeliId9', input: 'ID 012345678', expected: 'ID [redacted-id]' },
  { key: 'israeliPhone', input: 'נייד 054-1234567', expected: 'נייד [redacted-phone]' },
  { key: 'israeliLandline', input: 'טלפון 03-1234567', expected: 'טלפון [redacted-landline]' },
  { key: 'email', input: 'mail user.synthetic@example.com', expected: 'mail [redacted-email]' },
  { key: 'ilsAmount', input: 'יתרה: ₪ 1,234.50', expected: 'יתרה: ₪ [redacted-amount]' },
  { key: 'ilsAmountSuffix', input: 'יתרה: 1,234.50 ₪', expected: 'יתרה: [redacted-amount] ₪' },
  {
    key: 'telLinkRedactedHref',
    input: '<a href="tel:[redacted-id]">[redacted-id]</a>',
    expected: '<a href="tel:0000000000">0000000000</a>',
  },
  {
    key: 'telLinkRedactedIdHref',
    input: '{"phone":"tel:[redacted-landline]"}',
    expected: '{"phone":"tel:0000000000"}',
  },
];

/** Core look-alikes each rule must leave byte-for-byte unchanged. */
export const CORE_NEGATIVE_CASES: readonly IShapeCase[] = [
  unchanged('recaptchaTokenInput', '<input id="g-recaptcha-response" value="03AFcWeA5synthetic">'),
  unchanged('bearerToken', 'Authorization: Bearer short-token-1'),
  unchanged('jwtToken', '{"t":"eyJhbGciOiJIUzI1NiJ9.short.c3ln"}'),
  unchanged('lsessionIdParam', '?LSESSIONID_HINT=AbC123xyz456def'),
  unchanged('trackingIdParam', '?tid=12345678'),
  unchanged('trackingIdInAssetPath', '/assets/clarity_tag_uet_12345.js'),
  unchanged('trackingMidInAssetPath', '/a_mid_1b2c3d4e.js'),
  unchanged('trackingSidInAssetPath', '/a_sid_0123abc.js'),
  unchanged('hebrewGreetingName', '<h2>שלום</h2><p>ישראל ישראלי</p>'),
  unchanged('urlPathAccountId', '{"url":"/api/accounts/balance/12345"}'),
  unchanged('lastLoginText', '<span class="last-login-hint">Last visit 07/10/26 10:15</span>'),
  unchanged('numericBalanceSpan', '<span class="number-label">1,234.50</span>'),
  unchanged('jsonMonetaryField', '{"currentBalanceDate": 20261007}'),
  unchanged('jsonMonetaryField', '{"currentBalance":-0.00}'),
  unchanged('jsonAccountNumberField', '{"accountNumberMask": 4567123}'),
  unchanged('jsonAccountNumberField', '{"accountNumber": 0000000}'),
  unchanged('ilIban', 'ref IL62-0108'),
  unchanged('ilBankAccount', 'date 2026-10-07'),
  unchanged('ilBankAccount', 'acct 00-000-000000'),
  unchanged('hapoalimBranchAccount', 'ref 612 34567'),
  unchanged('hapoalimBranchAccount', 'ref 000-000000'),
  unchanged('israeliId9', 'ref 1234567890'),
  unchanged('israeliId9', 'ID 000000000'),
  unchanged('israeliPhone', 'ext 054-12345'),
  unchanged('israeliLandline', 'ext 03-12345'),
  unchanged('israeliLandline', 'ref 05-1234567'),
  unchanged('email', 'mail support at example.com'),
  unchanged('ilsAmount', 'שער ₪ —'),
  unchanged('ilsAmountSuffix', 'סכום 1,234.50 USD'),
  unchanged('telLinkRedactedHref', '<a href="mailto:[redacted-email]">[redacted-email]</a>'),
  unchanged('telLinkRedactedIdHref', '{"phone":"tel:[redacted-email]"}'),
];

/** A shape the redactor rewrites but the gate exempts by its context. */
export interface IContextExemptCase {
  readonly key: PiiPatternKey;
  readonly input: string;
  readonly reason: string;
}

/**
 * The deliberate redactor/gate asymmetries, one row per gate context
 * exemption: the redactor still rewrites these as a safety margin, while
 * the gate exempts them by their surrounding context because they are a
 * bank's public data (ads ids, published phones, marketing assets), not a
 * customer's.
 */
export const CONTEXT_EXEMPT_CASES: readonly IContextExemptCase[] = [
  {
    key: 'israeliId9',
    input: '<script src="https://www.googletagmanager.com/gtag/js?id=AW-123456789"></script>',
    reason: 'Google Ads conversion id',
  },
  {
    key: 'israeliId9',
    input: '<img src="https://ad.doubleclick.net/ddm/activity/ord=123456789">',
    reason: 'DoubleClick ad beacon',
  },
  {
    key: 'israeliId9',
    input: '<a href="tel:123456789">call</a>',
    reason: 'published phone link',
  },
  {
    key: 'israeliLandline',
    input: '<a href="tel:031234567">03-1234567</a>',
    reason: 'published phone link',
  },
  {
    key: 'ilsAmountSuffix',
    input: '<img src="/img/banner_100 NIS.png">',
    reason: 'marketing banner asset name',
  },
  {
    key: 'ilsAmountSuffix',
    input: '<img src="/img/hero_shivuki_250 ₪.png">',
    reason: 'marketing campaign asset name',
  },
];
