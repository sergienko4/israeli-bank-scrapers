/**
 * Shared cases for the PiiRedactor bank-shape rules: Radware bot tokens,
 * client IPs, anti-forgery and JSON session tokens, last-login stamps,
 * person names, opaque user ids, role-embedded accounts, and the Mizrahi
 * transliterated money, reference and branch fields.
 *
 * Two suites read these tables. One pins the redactor's exact output; the
 * other proves the `fixtures-pii` audit gate agrees with the redactor. Every
 * value is synthetic, and the IPv4 addresses are from the RFC 5737
 * documentation ranges.
 */

import { Buffer } from 'node:buffer';

import type { PiiPatternKey } from '../../../Integration/Tools/PiiRedactor.js';

/** One exact-output row: the rule it pins, its input and the full redacted output. */
export interface IShapeCase {
  readonly key: PiiPatternKey;
  readonly input: string;
  readonly expected: string;
}

/** A synthetic Radware session UUID. */
const SESSION_UUID = '1b2c3d4e-aaaa-4bbb-8ccc-abcdefabcdef';
/** A second synthetic Radware UUID, for values that carry two. */
const SESSION_UUID2 = '2c3d4e5f-bbbb-4ccc-8ddd-bcdefabcdef0';
/** The all-zero GUID the redactor writes in place of a server GUID. */
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
/** Radware bot token shape: `base64(<uuid>$<IPv4>)`. */
const BOT_TOKEN = Buffer.from(`${SESSION_UUID}$192.0.2.10`).toString('base64');
/** A token-length base64 run whose payload carries no address. */
const PLAIN_B64 = Buffer.from('static bundle digest without any address in it').toString('base64');
/** A token-length base64 run with `$<IPv4>` but no UUID before it. */
const PARTIAL_B64 = Buffer.from('build-manifest-entry-for-a-missing-uuid$192.0.2.10').toString(
  'base64',
);
/** An asset-length base64 run that embeds a `$<IPv4>`-like version. */
const ASSET_B64 = Buffer.from(
  `${SESSION_UUID}$192.0.2.10 is inside a long embedded asset, not a bot token`,
).toString('base64');
/** A synthetic anti-forgery token value. */
const RVT = 'CfDJ8abc-def_xyz';
/** Twelve forwarded hops, more than any bounded chain rule would scan. */
const HOP_COUNT = 12;
const LONG_CHAIN = Array.from({ length: HOP_COUNT }, (_, hop) => `203.0.113.${String(hop + 1)}`);
/** The placeholder the redactor writes for an anti-forgery token. */
const RVT_REDACTED = 'REDACTED_REQUEST_VERIFICATION_TOKEN';

/** Shapes each rule must rewrite, with the full expected output. */
export const POSITIVE_CASES: readonly IShapeCase[] = [
  {
    key: 'base64EmbeddedIp',
    input: `var __uzdbm_2 = '${BOT_TOKEN}';`,
    expected: "var __uzdbm_2 = 'REDACTED_BOT_TOKEN';",
  },
  {
    key: 'clientIpField',
    input: "var client_ip = '198.51.100.7';",
    expected: "var client_ip = '0.0.0.0';",
  },
  {
    key: 'clientIpField',
    input: String.raw`{\"clientIp\":\"192.0.2.10\"}`,
    expected: String.raw`{\"clientIp\":\"0.0.0.0\"}`,
  },
  {
    key: 'clientIpField',
    input: 'X-Forwarded-For: 203.0.113.5, 198.51.100.7',
    expected: 'X-Forwarded-For: 0.0.0.0, 0.0.0.0',
  },
  {
    key: 'clientIpField',
    input: '{"x-forwarded-for":"203.0.113.5, 198.51.100.7"}',
    expected: '{"x-forwarded-for":"0.0.0.0, 0.0.0.0"}',
  },
  {
    key: 'clientIpField',
    input: 'X-Forwarded-For: unknown, 203.0.113.5',
    expected: 'X-Forwarded-For: unknown, 0.0.0.0',
  },
  {
    key: 'clientIpField',
    input: 'X-Forwarded-For: 2001:db8::1, 203.0.113.5',
    expected: 'X-Forwarded-For: ::, 0.0.0.0',
  },
  {
    key: 'clientIpField',
    input: '{"clientIp":"::ffff:192.0.2.10"}',
    expected: '{"clientIp":"::"}',
  },
  {
    key: 'clientIpField',
    input: 'X-Forwarded-For: [2001:db8::1]:443, 203.0.113.5:8080',
    expected: 'X-Forwarded-For: [::]:443, 0.0.0.0:8080',
  },
  {
    key: 'clientIpField',
    input: 'X-Forwarded-For: 0.0.0.0, 203.0.113.5',
    expected: 'X-Forwarded-For: 0.0.0.0, 0.0.0.0',
  },
  {
    key: 'clientIpField',
    input: `X-Forwarded-For: ${LONG_CHAIN.join(', ')}`,
    expected: `X-Forwarded-For: ${LONG_CHAIN.map(() => '0.0.0.0').join(', ')}`,
  },
  {
    key: 'radwareSessionUuid',
    input: `var __uzdbm_1 = '${SESSION_UUID}';`,
    expected: `var __uzdbm_1 = '${ZERO_GUID}';`,
  },
  {
    key: 'radwareSessionUuid',
    input: `var __uzdbm_3 =\n  '1a2b3c${SESSION_UUID}1-17806608-0004c9027ee26c8d5';\nvar __uzdbm_2 = '${BOT_TOKEN}';`,
    expected: `var __uzdbm_3 =\n  '1a2b3c${ZERO_GUID}1-17806608-0004c9027ee26c8d5';\nvar __uzdbm_2 = 'REDACTED_BOT_TOKEN';`,
  },
  {
    key: 'radwareSessionUuid',
    input: `var __uzdbm_6 = '${SESSION_UUID}-${SESSION_UUID2}';`,
    expected: `var __uzdbm_6 = '${ZERO_GUID}-${ZERO_GUID}';`,
  },
  {
    key: 'radwareSessionUuid',
    input: `var __uzdbm_6 = '${ZERO_GUID}-${SESSION_UUID}';`,
    expected: `var __uzdbm_6 = '${ZERO_GUID}-${ZERO_GUID}';`,
  },
  {
    key: 'requestVerificationToken',
    input: `<input name="__RequestVerificationToken" type="hidden" value="${RVT}">`,
    expected: `<input name="__RequestVerificationToken" type="hidden" value="${RVT_REDACTED}">`,
  },
  {
    key: 'requestVerificationToken',
    input: `<input value="${RVT}" type="hidden" name="__RequestVerificationToken">`,
    expected: `<input value="${RVT_REDACTED}" type="hidden" name="__RequestVerificationToken">`,
  },
  {
    key: 'requestVerificationToken',
    input: String.raw`<input name=\"__RequestVerificationToken\" value=\"${RVT}\">`,
    expected: String.raw`<input name=\"__RequestVerificationToken\" value=\"${RVT_REDACTED}\">`,
  },
  {
    key: 'requestVerificationToken',
    input: `<input value='${RVT}' name='__requestverificationtoken'>`,
    expected: `<input value='${RVT_REDACTED}' name='__requestverificationtoken'>`,
  },
  {
    key: 'requestVerificationToken',
    input: `<input name="__RequestVerificationToken" data-acct="[redacted-account]" value="${RVT}">`,
    expected: `<input name="__RequestVerificationToken" data-acct="[redacted-account]" value="${RVT_REDACTED}">`,
  },
  {
    key: 'requestVerificationToken',
    input: `<input name="__RequestVerificationToken" value="REDACTED_${RVT}">`,
    expected: `<input name="__RequestVerificationToken" value="${RVT_REDACTED}">`,
  },
  {
    key: 'cookieAuthValue',
    input: 'cookie: a=[redacted-cookie]; session=abc123live',
    expected: 'cookie: a=[redacted-cookie]; session=[redacted-cookie]',
  },
  {
    key: 'cookieAuthValue',
    input: 'Set-Cookie: xauth=[redacted-cookie]; session=abc123live; token=def456live',
    expected:
      'Set-Cookie: xauth=[redacted-cookie]; session=[redacted-cookie]; token=[redacted-cookie]',
  },
  {
    key: 'cookieAuthValue',
    input: 'Set-Cookie: session="abc123live"; Path=/',
    expected: 'Set-Cookie: session="[redacted-cookie]"; Path=/',
  },
  {
    key: 'cookieAuthValue',
    input: String.raw`{"h":"Set-Cookie: session=\"abc123live\"; token=\"def456live\""}`,
    expected: String.raw`{"h":"Set-Cookie: session=\"[redacted-cookie]\"; token=\"[redacted-cookie]\""}`,
  },
  {
    key: 'jsonTokenField',
    input: '{"xsrfToken":"a1b2c3d4e5f6a7b8"}',
    expected: '{"xsrfToken":"[redacted-token]"}',
  },
  {
    key: 'jsonTokenField',
    input: String.raw`{\"xsrfToken\":\"a1b2c3d4e5f6a7b8\"}`,
    expected: String.raw`{\"xsrfToken\":\"[redacted-token]\"}`,
  },
  {
    key: 'jsonTokenField',
    input: '{"xsrfToken":"[redacted-token]a1b2c3d4"}',
    expected: '{"xsrfToken":"[redacted-token]"}',
  },
  {
    key: 'jsonTokenField',
    input: '{"xsrfToken":"FIXTURE-a1b2c3d4e5f6","csrfToken":"REDACTEDa1b2c3d4e5"}',
    expected: '{"xsrfToken":"[redacted-token]","csrfToken":"[redacted-token]"}',
  },
  {
    key: 'jsonTokenField',
    input: String.raw`{"accessToken":"a1b2c3\/d4e5f6\/a7b8"}`,
    expected: '{"accessToken":"[redacted-token]"}',
  },
  {
    key: 'jsonTokenField',
    input: String.raw`{"xsrfToken":"[redacted-token]\"a1b2c3d4"}`,
    expected: '{"xsrfToken":"[redacted-token]"}',
  },
  {
    key: 'jsonActionGuid',
    input: `{"actionGUID":"${SESSION_UUID}","isHasMoreRows":false}`,
    expected: `{"actionGUID":"${ZERO_GUID}","isHasMoreRows":false}`,
  },
  {
    key: 'hebrewLastLoginLabel',
    input: '<p>כניסתך האחרונה: 07/10/26 18:54</p>',
    expected: '<p>כניסתך האחרונה: [redacted-last-login]</p>',
  },
  {
    key: 'hebrewLastLoginLabel',
    input: '<span>ביקורך האחרון</span> <b>07/10/2026 , 18:54</b>',
    expected: '<span>ביקורך האחרון</span> <b>[redacted-last-login]</b>',
  },
  {
    key: 'jsonLastLoginField',
    input: '{"LastTimeVisited":"07/10/2026 18:54","TaarichPeulaAhrona":"2026-10-07T00:00:00"}',
    expected:
      '{"LastTimeVisited":"[redacted-last-login]","TaarichPeulaAhrona":"[redacted-last-login]"}',
  },
  {
    key: 'jsonLastLoginField',
    input: '{"LastTimeVisited":"[redacted-last-login] 18:54"}',
    expected: '{"LastTimeVisited":"[redacted-last-login]"}',
  },
  {
    key: 'jsonLastLoginField',
    input: '{"LastTimeVisited":"07/10/2026 [redacted-last-login]"}',
    expected: '{"LastTimeVisited":"[redacted-last-login]"}',
  },
  {
    key: 'jsonLastLoginField',
    input: String.raw`{"LastTimeVisited":"\/Date(1791360840000)\/"}`,
    expected: '{"LastTimeVisited":"[redacted-last-login]"}',
  },
  {
    key: 'jsonLastLoginField',
    input: String.raw`{\"_LastTimeLogin\":\"07\\/10\\/2026\"}`,
    expected: String.raw`{\"_LastTimeLogin\":\"[redacted-last-login]\"}`,
  },
  {
    key: 'jsonPersonNameField',
    input: '{"FirstName": "Dana", "LastName": "Levi", "BankerName": "Moshe Cohen"}',
    expected:
      '{"FirstName": "[redacted-name]", "LastName": "[redacted-name]", "BankerName": "[redacted-name]"}',
  },
  {
    key: 'jsonPersonNameField',
    input: '{"LastName": "[redacted-name] Levi"}',
    expected: '{"LastName": "[redacted-name]"}',
  },
  {
    key: 'jsonPersonNameField',
    input: '{"firstName": "Dana [redacted-name]"}',
    expected: '{"firstName": "[redacted-name]"}',
  },
  {
    key: 'jsonPersonNameField',
    input: '{"displayName": "Dana Levi", "custFullName": "Dana Levi"}',
    expected: '{"displayName": "[redacted-name]", "custFullName": "[redacted-name]"}',
  },
  {
    key: 'jsonPersonNameField',
    input: '{"customerFullName": "Dana Levi", "firstName": "Dana"}',
    expected: '{"customerFullName": "[redacted-name]", "firstName": "[redacted-name]"}',
  },
  {
    key: 'jsonPersonNameField',
    input: String.raw`{\"partyLastName\":\"Levi\"}`,
    expected: String.raw`{\"partyLastName\":\"[redacted-name]\"}`,
  },
  {
    key: 'jsonPersonNameField',
    input: String.raw`{"FirstName":"Dana \"Dee\" Levi"}`,
    expected: '{"FirstName":"[redacted-name]"}',
  },
  {
    key: 'jsonPersonNameField',
    input: String.raw`{"LastName":"[redacted-name]\" Levi"}`,
    expected: '{"LastName":"[redacted-name]"}',
  },
  {
    key: 'jsonPersonNameField',
    input: String.raw`{\"lastName\":\"Levi \\\"Jr\\\" Cohen\"}`,
    expected: String.raw`{\"lastName\":\"[redacted-name]\"}`,
  },
  {
    key: 'jsonPersonNameField',
    input: String.raw`{"firstName":"\u05d3\u05e0\u05d4"}`,
    expected: '{"firstName":"[redacted-name]"}',
  },
  {
    key: 'jsonOpaqueUserIdField',
    input: '{"ClientGWIdentifier": "1a2345b6c7d8", "anonymousID": "ab12cd"}',
    expected: '{"ClientGWIdentifier": "[redacted-user-id]", "anonymousID": "[redacted-user-id]"}',
  },
  {
    key: 'jsonOpaqueUserIdField',
    input: String.raw`{\"UserId\":\"[redacted-user-id]77\"}`,
    expected: String.raw`{\"UserId\":\"[redacted-user-id]\"}`,
  },
  {
    key: 'jsonOpaqueUserIdField',
    input: String.raw`{"UserIdentifier":"[redacted-user-id]\"ab12"}`,
    expected: '{"UserIdentifier":"[redacted-user-id]"}',
  },
  {
    key: 'jsonOpaqueUserIdField',
    input: String.raw`{\"Username\":\"dana\\\\levi\"}`,
    expected: String.raw`{\"Username\":\"[redacted-user-id]\"}`,
  },
  {
    key: 'glassboxUserIdAttr',
    input: '<div class="main-all-content" data.glassbox-id="1a2345b6c7d8">',
    expected: '<div class="main-all-content" data.glassbox-id="[redacted-user-id]">',
  },
  {
    key: 'glassboxUserIdAttr',
    input: '<div data-glassbox-id="[redacted-user-id]x9">',
    expected: '<div data-glassbox-id="[redacted-user-id]">',
  },
  {
    key: 'roleEmbeddedAccount',
    input: '{"Role": "AC_123456_FUNDS_ACTIVITY"}',
    expected: '{"Role": "AC_[redacted-account]_FUNDS_ACTIVITY"}',
  },
  {
    key: 'mizNumericAttr',
    input: '<span miz-numeric-colorup="-1,250.75"></span>',
    expected: '<span miz-numeric-colorup="0"></span>',
  },
  {
    key: 'mizNumericText',
    input: '<span miz-numeric-colorup="120" class="amt">\u202A120.00</span>',
    expected: '<span miz-numeric-colorup="0" class="amt">\u202A[redacted-amount]</span>',
  },
  {
    key: 'currencyAmountAttr',
    input: '<div class="amt" sky-on-currency-change="vm.x()" currency="-120.5" sky-currency="c">',
    expected: '<div class="amt" sky-on-currency-change="vm.x()" currency="0" sky-currency="c">',
  },
  {
    key: 'currencyAmountAttr',
    input: '<div class="amt" currency="1,250" sky-currency="c">',
    expected: '<div class="amt" currency="0" sky-currency="c">',
  },
  {
    key: 'mizrahiReferenceCell',
    input: '<td ng-class="isCloseToZero(dataItem.MC02AsmEZ)" class="ref"> 4321</td>',
    expected: '<td ng-class="isCloseToZero(dataItem.MC02AsmEZ)" class="ref"> [redacted-id]</td>',
  },
  {
    key: 'jsonTranslitMoneyNumber',
    input: '{"YitraAdkanit": 120.5, "MC02SchumEZ": -45, "MC04Schum1EZ": 7, "Remain": 3}',
    expected: '{"YitraAdkanit": 0, "MC02SchumEZ": 0, "MC04Schum1EZ": 0, "Remain": 0}',
  },
  {
    key: 'jsonTranslitMoneyString',
    input: '{"itra": "120", "itraLelo_shekim": "-7.25", "misgeret_kolel": "900"}',
    expected: '{"itra": "0", "itraLelo_shekim": "0", "misgeret_kolel": "0"}',
  },
  {
    key: 'jsonMizrahiReference',
    input: '{"MC02AsmEZ": 4321}',
    expected: '{"MC02AsmEZ": 0}',
  },
  {
    key: 'jsonBranchField',
    input: '{"Branch":"123","BranchForDispaly":"45","BranchForMF":"123"}',
    expected: '{"Branch":"000","BranchForDispaly":"000","BranchForMF":"000"}',
  },
  {
    key: 'branchBeforeRedactedAccount',
    input: '{"SnifAndNumber":"123-[redacted-account]"}',
    expected: '{"SnifAndNumber":"000-[redacted-account]"}',
  },
];

/**
 * Build a row for a look-alike the redactor must leave byte-for-byte unchanged.
 *
 * @param key - Rule the look-alike is aimed at.
 * @param input - The look-alike text.
 * @returns A case whose expected output is its input.
 */
export function unchanged(key: PiiPatternKey, input: string): IShapeCase {
  return { key, input, expected: input };
}

/** Look-alikes each rule must leave byte-for-byte unchanged. */
export const NEGATIVE_CASES: readonly IShapeCase[] = [
  unchanged('base64EmbeddedIp', `"hash":"${PLAIN_B64}"`),
  unchanged('base64EmbeddedIp', `"hash":"${PARTIAL_B64}"`),
  unchanged('base64EmbeddedIp', `"asset":"${ASSET_B64}"`),
  unchanged('clientIpField', "var app_version = '1.20.30.4';"),
  unchanged('clientIpField', '{"client_ip":"300.1.2.3"}'),
  unchanged('clientIpField', 'X-Forwarded-Port: 443, 8443'),
  unchanged('clientIpField', '{"client_ip":"unknown"}'),
  unchanged('clientIpField', '{"clientIp":"12:34:56"}'),
  unchanged('clientIpField', '{"clientIp":"aa:bb:cc:dd:ee:ff"}'),
  unchanged('clientIpField', 'X-Forwarded-For: 0.0.0.0, ::'),
  unchanged('radwareSessionUuid', `var other = '${SESSION_UUID}';`),
  unchanged('radwareSessionUuid', "var __uzdbm_4 = 'false';"),
  unchanged('radwareSessionUuid', "var __uzdbm_6 = '';"),
  unchanged(
    'radwareSessionUuid',
    `var __uzdbm_3 = '1a2b3c${ZERO_GUID}1-17806608-0004c9027ee26c8d5';`,
  ),
  unchanged('requestVerificationToken', '<input name="query" value="CfDJ8abc">'),
  unchanged(
    'requestVerificationToken',
    `<input name="__RequestVerificationToken" value="${RVT_REDACTED}">`,
  ),
  unchanged('cookieAuthValue', 'cookie: theme=dark; lang=he'),
  unchanged('cookieAuthValue', 'cookie: authorized=1; sessions_seen=2'),
  unchanged('cookieAuthValue', 'Set-Cookie: session=""; Path=/'),
  unchanged('jsonTokenField', '{"token":"a1b2c3d4e5f6a7b8","xsrfToken":"short"}'),
  unchanged(
    'jsonTokenField',
    '{"sessionToken":"FIXTURE-MAX-SESSION-A","accessToken":"[redacted-jwt]"}',
  ),
  unchanged('jsonTokenField', String.raw`{\"xsrfToken\":\"[redacted-token]\"}`),
  unchanged('jsonTokenField', String.raw`{"xsrfToken":"a1b2\/c3d4"}`),
  unchanged('jsonActionGuid', `{"requestGUID":"${SESSION_UUID}"}`),
  unchanged('jsonActionGuid', '{"actionGUID":"abcdef12-not-a-guid"}'),
  unchanged('hebrewLastLoginLabel', '<p>תאריך ערך: 07/10/26 18:54</p>'),
  unchanged('jsonLastLoginField', '{"TaarichErech":"2026-10-07T00:00:00"}'),
  unchanged('jsonLastLoginField', String.raw`{\"LastTimeVisited\":\"[redacted-last-login]\"}`),
  unchanged('jsonPersonNameField', '{"BankerNameLabel": "Your banker"}'),
  unchanged('jsonPersonNameField', '{"displayNameKey": "account.title"}'),
  unchanged('jsonPersonNameField', '{"firstName": ""}'),
  unchanged('jsonOpaqueUserIdField', '{"UserType": "private"}'),
  unchanged('glassboxUserIdAttr', '<div class="main-all-content" data-role="shell">'),
  unchanged('roleEmbeddedAccount', '{"Role": "AC_FUNDS_ACTIVITY", "Alt": "AC_1234_VIEW"}'),
  unchanged('mizNumericText', '<span class="amt">\u202A120.00</span>'),
  unchanged('mizNumericAttr', '<span miz-numeric-colorup="1.2.3"></span>'),
  unchanged('mizNumericAttr', '<span miz-numeric-colorup="-0.00"></span>'),
  unchanged('mizrahiReferenceCell', '<td ng-class="isCloseToZero(dataItem.MC02AsmEZ)">0</td>'),
  unchanged('mizrahiReferenceCell', '<td ng-class="isCloseToZero(dataItem.MC02AsmEZDate)"> 7</td>'),
  unchanged('jsonMizrahiReference', '{"MC02AsmEZSpecified": true, "MC02Asm": 4321}'),
  unchanged('branchBeforeRedactedAccount', '{"Code":"1234-[redacted-account]"}'),
  unchanged('currencyAmountAttr', '<miz-amount currency="vm.currency"></miz-amount>'),
  unchanged('currencyAmountAttr', '<div class="flag" currency="840"></div>'),
  unchanged('currencyAmountAttr', '<div sky-currency-format="x" currency="840"></div>'),
  unchanged('currencyAmountAttr', '<div currency="840" sky-on-currency-changed="x"></div>'),
  unchanged('jsonTranslitMoneyString', '{"YitraDate": "2026-10-07"}'),
  unchanged(
    'jsonTranslitMoneyString',
    '{"itra_date": "07/10/2026 18:54:00", "MisgeretHour": null, "Remaining": 3}',
  ),
  unchanged('jsonTranslitMoneyNumber', '{"MC02SchumEZSpecified": true, "Yitra": ".5.5"}'),
  unchanged('jsonTranslitMoneyNumber', '{"MisgeretHour": 1854, "itra_date": 20261007}'),
  unchanged('jsonTranslitMoneyNumber', '{"itra": 1.2.3}'),
  unchanged('jsonBranchField', '{"Branch":"Tel Aviv"}'),
];
