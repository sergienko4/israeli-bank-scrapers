/**
 * Unit tests for the PiiRedactor bank-shape rules: Radware bot tokens,
 * anti-forgery and JSON session tokens, last-login stamps, and the
 * Mizrahi transliterated money, reference and branch fields.
 *
 * Every value is synthetic; the IPv4 address is from the RFC 5737
 * documentation range.
 */

import { Buffer } from 'node:buffer';

import { type PiiPatternKey, redactPii } from '../../../Integration/Tools/PiiRedactor.js';

/** One exact-output row: the rule it pins, its input and the full redacted output. */
interface IShapeCase {
  readonly key: PiiPatternKey;
  readonly input: string;
  readonly expected: string;
}

/** A synthetic Radware session UUID. */
const SESSION_UUID = '1b2c3d4e-aaaa-4bbb-8ccc-abcdefabcdef';
/** The all-zero GUID the redactor writes in place of a server GUID. */
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
/** Radware bot token shape: `base64(<uuid>$<IPv4>)`. */
const BOT_TOKEN = Buffer.from(`${SESSION_UUID}$192.0.2.10`).toString('base64');
/** A long base64 run whose payload carries no address. */
const PLAIN_B64 = Buffer.from('static bundle digest without any address in it').toString('base64');

const POSITIVE_CASES: readonly IShapeCase[] = [
  {
    key: 'base64EmbeddedIp',
    input: `var __uzdbm_2 = '${BOT_TOKEN}';`,
    expected: "var __uzdbm_2 = 'REDACTED_BOT_TOKEN';",
  },
  {
    key: 'radwareSessionUuid',
    input: `var __uzdbm_1 = '${SESSION_UUID}';`,
    expected: `var __uzdbm_1 = '${ZERO_GUID}';`,
  },
  {
    key: 'requestVerificationToken',
    input: '<input name="__RequestVerificationToken" type="hidden" value="CfDJ8abc-def_xyz">',
    expected:
      '<input name="__RequestVerificationToken" type="hidden" value="REDACTED_REQUEST_VERIFICATION_TOKEN">',
  },
  {
    key: 'requestVerificationToken',
    input: '<input value="CfDJ8abc-def_xyz" type="hidden" name="__RequestVerificationToken">',
    expected:
      '<input value="REDACTED_REQUEST_VERIFICATION_TOKEN" type="hidden" name="__RequestVerificationToken">',
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
    key: 'mizNumericText',
    input: '<span miz-numeric-colorup="120" class="amt">\u202A120.00</span>',
    expected: '<span miz-numeric-colorup="0" class="amt">\u202A[redacted-amount]</span>',
  },
  {
    key: 'currencyAmountAttr',
    input: '<miz-amount currency="-120.5"></miz-amount>',
    expected: '<miz-amount currency="0"></miz-amount>',
  },
  {
    key: 'mizrahiReferenceCell',
    input: '<td ng-class="isCloseToZero(dataItem.MC02AsmEZ)" class="ref"> 4321</td>',
    expected: '<td ng-class="isCloseToZero(dataItem.MC02AsmEZ)" class="ref"> [redacted-id]</td>',
  },
  {
    key: 'jsonTranslitMoneyNumber',
    input: '{"YitraAdkanit": 120.5, "MC02SchumEZ": -45, "Remain": 3}',
    expected: '{"YitraAdkanit": 0, "MC02SchumEZ": 0, "Remain": 0}',
  },
  {
    key: 'jsonTranslitMoneyString',
    input: '{"itra": "120", "itraLelo_shekim": "-7.25"}',
    expected: '{"itra": "0", "itraLelo_shekim": "0"}',
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

/** Look-alikes each rule must leave byte-for-byte unchanged. */
const NEGATIVE_CASES: readonly IShapeCase[] = [
  { key: 'base64EmbeddedIp', input: `"hash":"${PLAIN_B64}"`, expected: `"hash":"${PLAIN_B64}"` },
  {
    key: 'radwareSessionUuid',
    input: `var other = '${SESSION_UUID}';`,
    expected: `var other = '${SESSION_UUID}';`,
  },
  {
    key: 'requestVerificationToken',
    input: '<input name="query" value="CfDJ8abc">',
    expected: '<input name="query" value="CfDJ8abc">',
  },
  {
    key: 'jsonTokenField',
    input: '{"token":"a1b2c3d4e5f6a7b8","xsrfToken":"short"}',
    expected: '{"token":"a1b2c3d4e5f6a7b8","xsrfToken":"short"}',
  },
  {
    key: 'jsonTokenField',
    input: '{"sessionToken":"FIXTURE-MAX-SESSION-A","token2Token":"SYNTHETIC_PLACEHOLDER"}',
    expected: '{"sessionToken":"FIXTURE-MAX-SESSION-A","token2Token":"SYNTHETIC_PLACEHOLDER"}',
  },
  {
    key: 'jsonActionGuid',
    input: `{"requestGUID":"${SESSION_UUID}"}`,
    expected: `{"requestGUID":"${SESSION_UUID}"}`,
  },
  {
    key: 'hebrewLastLoginLabel',
    input: '<p>תאריך ערך: 07/10/26 18:54</p>',
    expected: '<p>תאריך ערך: 07/10/26 18:54</p>',
  },
  {
    key: 'jsonLastLoginField',
    input: '{"TaarichErech":"2026-10-07T00:00:00"}',
    expected: '{"TaarichErech":"2026-10-07T00:00:00"}',
  },
  {
    key: 'currencyAmountAttr',
    input: '<miz-amount currency="vm.currency"></miz-amount>',
    expected: '<miz-amount currency="vm.currency"></miz-amount>',
  },
  {
    key: 'jsonTranslitMoneyString',
    input: '{"YitraDate": "2026-10-07"}',
    expected: '{"YitraDate": "2026-10-07"}',
  },
  {
    key: 'jsonBranchField',
    input: '{"Branch":"Tel Aviv"}',
    expected: '{"Branch":"Tel Aviv"}',
  },
];

describe('PiiRedactor bank-shape rules', () => {
  it.each(POSITIVE_CASES)('redacts the $key shape to its placeholder', row => {
    const out = redactPii(row.input);
    expect(out).toBe(row.expected);
  });

  it.each(NEGATIVE_CASES)('leaves a $key look-alike untouched', row => {
    const out = redactPii(row.input);
    expect(out).toBe(row.expected);
  });

  it.each(POSITIVE_CASES)('is idempotent on redacted $key output', row => {
    const again = redactPii(row.expected);
    expect(again).toBe(row.expected);
  });
});
