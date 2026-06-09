/**
 * Unit tests for PiiRedactor — sanitises bank-fixture HTML/JSON.
 */

import {
  OPERATOR_LITERALS,
  PII_PATTERNS,
  PII_REPLACEMENTS,
  type PiiPatternKey,
  redactJson,
  redactPii,
} from '../../../Integration/Tools/PiiRedactor.js';

/** One row of the redact table: pattern, positive sample, expected replacement, negative sample. */
interface IRedactCase {
  readonly key: PiiPatternKey;
  readonly positive: string;
  readonly expected: string;
  readonly negative: string;
}

const REDACT_CASES: readonly IRedactCase[] = [
  {
    key: 'israeliId9',
    positive: 'id 305555555 here',
    expected: '[redacted-id]',
    negative: 'short 12345 stays',
  },
  {
    key: 'israeliPhone',
    positive: 'call 052-1234567 now',
    expected: '[redacted-phone]',
    negative: 'office 044 1234567 stays',
  },
  {
    key: 'israeliLandline',
    positive: 'tel 03-6364554 contact',
    expected: '[redacted-landline]',
    negative: 'tel 067-1234567 stays',
  },
  {
    key: 'email',
    positive: 'me@example.com sent',
    expected: '[redacted-email]',
    negative: 'no-arroba domain.com stays',
  },
  {
    key: 'bearerToken',
    positive: 'Authorization: Bearer abcdefghijklmnopqrstuvwx',
    expected: '[redacted-bearer]',
    negative: 'Bearer short',
  },
  {
    key: 'jwtToken',
    positive: 'token eyJabcdefghij.0123456789abc.signaturedataXYZ end',
    expected: '[redacted-jwt]',
    negative: 'eyJshort',
  },
  {
    key: 'ilIban',
    positive: 'IL620108000000099999999 ok',
    expected: '[redacted-iban]',
    negative: 'IL00 only',
  },
  {
    key: 'ilsAmount',
    positive: 'balance: ₪1,234.56 yes',
    expected: '[redacted-amount]',
    negative: 'plain 1,234.56 stays',
  },
  {
    key: 'ilsAmountSuffix',
    positive: 'balance 144.70 ₪ shown',
    expected: '[redacted-amount]',
    negative: '144.70 USD stays',
  },
  {
    key: 'cookieAuthValue',
    positive: 'Set-Cookie: auth=zxcvbnmasdf1234567890;',
    expected: '[redacted-cookie]',
    negative: 'auth-free cookie',
  },
  {
    key: 'hebrewGreetingName',
    positive: '<div><h1>שלום</h1><p>John Doe</p></div>',
    expected: '[redacted-name]',
    negative: '<div><h1>שלום</h1><span>welcome</span></div>',
  },
  {
    key: 'lastLoginText',
    positive: '<p class="last-login">ביקורך האחרון 07/06/26 | 18:08</p>',
    expected: '[redacted-last-login]',
    negative: '<p class="other">ביקורך האחרון לא ידוע</p>',
  },
  {
    key: 'numericBalanceSpan',
    positive: '<span class="number-strong"> 144.70</span>',
    expected: '[redacted-amount]',
    negative: '<span class="other"> 144.70</span>',
  },
  {
    key: 'ilBankAccount',
    positive: 'account 99-999-991234 here',
    expected: '[redacted-account]',
    negative: 'date 2024-12-26 stays',
  },
  {
    key: 'lsessionIdParam',
    positive:
      'src="/pixel?cid=1&LSESSIONID=eyJlIjoiY01RQXl%3D%3D.2c0079f336bd0090.N2Y%3D%3D&t=jsonp"',
    expected: 'LSESSIONID=REDACTED_SESSION_ID',
    negative: 'LSESSIONID-no-equals stays',
  },
  {
    key: 'trackingIdParam',
    positive: '<iframe src="https://ads.example/?ord=1&ti=187049083&end"/>',
    expected: 'ti=REDACTED_TRACKING_ID',
    negative: 'tilde=foo stays',
  },
  {
    key: 'trackingIdInAssetPath',
    positive: 'src="assets/0384-bat.bing.com_action_0_ti_187049083_Ver_2_mid"',
    expected: '_ti_REDACTED_TRACKING_ID',
    negative: 'src="assets/0399-clarity.js" stays',
  },
  {
    key: 'trackingMidInAssetPath',
    positive: 'src="assets/0384-bat.bing_mid_9d25e645-3325-439f-b273-005722a02d2a_bo_1"',
    expected: '_mid_REDACTED_SESSION_UUID',
    negative: 'src="assets/safe.js" stays',
  },
  {
    key: 'trackingSidInAssetPath',
    positive: 'src="assets/0384-bat.bing_sid_44d8351060cb11f19c27df01aa955"',
    expected: '_sid_REDACTED_SESSION_HEX',
    negative: 'src="assets/safe.js" stays',
  },
  {
    key: 'telLinkRedactedIdHref',
    positive: '<a href="tel:[redacted-id]">call</a>',
    expected: 'tel:0000000000',
    negative: '<a href="tel:0000000000">stays</a>',
  },
  {
    key: 'telLinkRedactedHref',
    positive: '<a class="x" href="tel:[redacted-landline]" data-y="z">[redacted-landline]</a>',
    expected: '>0000000000</a>',
    negative: '<a class="x" href="tel:0000000000">0000000000</a>',
  },
];

describe('PiiRedactor', () => {
  describe('redactPii — per-pattern positive + negative coverage', () => {
    it.each(REDACT_CASES)('redacts $key positives but leaves negatives untouched', row => {
      const positiveOut = redactPii(row.positive);
      const negativeOut = redactPii(row.negative);
      expect(positiveOut).toContain(row.expected);
      expect(negativeOut).toBe(row.negative);
    });
  });

  it('handles recaptcha-token input attribute value', () => {
    const html = '<input id="recaptcha-token" value="03ANYolqs..secret..XYZ"/>';
    const out = redactPii(html);
    expect(out).toBe('<input id="recaptcha-token" value="REDACTED_RECAPTCHA_TOKEN"/>');
  });

  it('handles recaptcha anchor init payload', () => {
    const raw = 'recaptcha.anchor.Main.init( "abcdefghijklmnop")';
    const out = redactPii(raw);
    expect(out).toBe('recaptcha.anchor.Main.init( "REDACTED_RECAPTCHA_PAYLOAD")');
  });

  it('PII_REPLACEMENTS covers every pattern key', () => {
    const patternKeys = Object.keys(PII_PATTERNS);
    const sortedPatterns = [...patternKeys].sort();
    const replacementKeys = Object.keys(PII_REPLACEMENTS);
    const sortedReplacements = [...replacementKeys].sort();
    expect(sortedReplacements).toEqual(sortedPatterns);
  });

  describe('redactJson', () => {
    it('redacts PII inside parsed JSON values', () => {
      const value = { name: 'Alice', email: 'alice@example.com', balance: '₪1,000.00' };
      const out = redactJson(value);
      expect(out).toContain('[redacted-email]');
      expect(out).toContain('[redacted-amount]');
      expect(out).toMatch(/\n {2}"name"/u);
    });

    it('emits "null" for undefined input', () => {
      const out = redactJson(undefined);
      expect(out).toBe('null');
    });
  });

  describe('chained-redaction ordering', () => {
    it('redacts an ID embedded inside a longer payload without eating boundaries', () => {
      const html = '<span>זהות 305555555</span><span>305444444</span>';
      const redacted = redactPii(html);
      expect(redacted).toBe('<span>זהות [redacted-id]</span><span>[redacted-id]</span>');
    });
  });

  describe('uniquifyQuotedRedactedIds post-pass — JS object-literal duplicate-key prevention', () => {
    it('uniquifies single-quoted JS object keys so distinct entries do not collide', () => {
      const js = "{'305555555': {a:1}, '305444444': {a:2}, '305333333': {a:3}}";
      const out = redactPii(js);
      expect(out).toContain("'[redacted-id-1]'");
      expect(out).toContain("'[redacted-id-2]'");
      expect(out).toContain("'[redacted-id-3]'");
    });

    it('uniquifies double-quoted JSON keys the same way', () => {
      const json = '{"305555555": 1, "305444444": 2}';
      const out = redactPii(json);
      expect(out).toContain('"[redacted-id-1]"');
      expect(out).toContain('"[redacted-id-2]"');
    });

    it('repairs prettier-corrupted [redacted - id] (with spaces) by wrapping + uniquifying', () => {
      const js = "['.baidu.', 3, [redacted - id]],['.yastatic.', 3, [redacted - id]]";
      const out = redactPii(js);
      expect(out).toContain('"[redacted-id-1]"');
      expect(out).toContain('"[redacted-id-2]"');
    });

    it('leaves unquoted HTML-text [redacted-id] untouched (no JS-collision risk)', () => {
      const html = '<p>Customer ID: 305555555 / 305444444</p>';
      const out = redactPii(html);
      expect(out).toBe('<p>Customer ID: [redacted-id] / [redacted-id]</p>');
    });

    it('resets counter per call (deterministic per file in sweep)', () => {
      const first = redactPii("'305555555'");
      const second = redactPii("'305444444'");
      expect(first).toContain("'[redacted-id-1]'");
      expect(second).toContain("'[redacted-id-1]'");
    });
  });

  describe('telLinkRedactedHref — anchor text/href consistency', () => {
    it('rewrites both href and visible text in <a href="tel:...">[redacted-*]</a>', () => {
      const html = '<a class="x" href="tel:[redacted-landline]">[redacted-landline]</a>';
      const out = redactPii(html);
      expect(out).toBe('<a class="x" href="tel:0000000000">0000000000</a>');
    });
  });

  describe('jsonMonetaryField — raw numeric balance fields', () => {
    it('redacts currentBalance numeric to 0', () => {
      const json = '"currentBalance": 144.7,';
      const out = redactPii(json);
      expect(out).toBe('"currentBalance": 0,');
    });

    it('redacts negative withdrawalAmount to 0', () => {
      const json = '"withdrawalAmount": -50.5,';
      const out = redactPii(json);
      expect(out).toBe('"withdrawalAmount": 0,');
    });

    it('leaves percent / code fields untouched', () => {
      const json = '"creditLimitUtilizationPercent": 0,"messageCode": 107';
      const out = redactPii(json);
      expect(out).toBe(json);
    });

    it('redacts every monetary field in a Hapoalim balance response', () => {
      const json = JSON.stringify({
        currentAccountLimitsAmount: 0,
        withdrawalBalance: 144.7,
        currentBalance: 144.7,
        creditLimitUtilizationPercent: 0,
        creditLimitAmount: 0,
      });
      const out = redactPii(json);
      expect(out).not.toContain('144.7');
      expect(out).toContain('"creditLimitUtilizationPercent":0');
    });
  });

  describe('hebrewGreetingName — bank post-login greeting card', () => {
    it('redacts customer name inside <h1>שלום</h1><p>NAME</p>', () => {
      const html = '<div class="mobile-user-title"><h1>שלום</h1><p>John Doe</p></div>';
      const out = redactPii(html);
      expect(out).not.toContain('John Doe');
      expect(out).toContain('[redacted-name]');
    });

    it('redacts name in <h1 id="main-title">שלום</h1><p>NAME</p>', () => {
      const html = '<section><h1 id="main-title" tabindex="0">שלום</h1><p>John Doe</p></section>';
      const out = redactPii(html);
      expect(out).not.toContain('John Doe');
      expect(out).toContain('[redacted-name]');
    });
  });

  describe('jsonPersonNameField — bank API response name fields', () => {
    it('redacts partyFullName in JSON object', () => {
      const json = '{"partyFullName": "John Doe", "id": 1}';
      const out = redactPii(json);
      expect(out).not.toContain('John Doe');
      expect(out).toContain('[redacted-name]');
    });

    it('redacts partyFirstName in escaped NDJSON envelope', () => {
      const ndjson = '{"envelope":"{\\"partyFirstName\\": \\"Jane\\"}"}';
      const out = redactPii(ndjson);
      expect(out).not.toContain('Jane');
      expect(out).toContain('[redacted-name]');
    });

    it('redacts customerName but leaves bank-name field untouched', () => {
      const json = '{"customerName": "John Doe", "bankName": "Hapoalim"}';
      const out = redactPii(json);
      expect(out).toContain('[redacted-name]');
      expect(out).toContain('"bankName": "Hapoalim"');
    });
  });

  describe('operator-known PII literals', () => {
    it('redacts Hebrew surname literal in transaction descriptions', () => {
      const surname = OPERATOR_LITERALS.hebrewSurname;
      const given = OPERATOR_LITERALS.hebrewGivenName;
      const html = `<span>העברה מ${given} ${surname} חשבון</span>`;
      const out = redactPii(html);
      expect(out).not.toContain(surname);
      expect(out).not.toContain(given);
      expect(out).toContain('[redacted-name]');
    });

    it('redacts English operator names in HTML/JSON', () => {
      const opName = OPERATOR_LITERALS.englishOperatorName;
      const html = `<span>From ${opName}, Yevgeny</span>`;
      const out = redactPii(html);
      expect(out).not.toContain(opName);
      expect(out).toContain('[redacted-name]');
    });

    it('redacts operator username anywhere it leaks', () => {
      const username = OPERATOR_LITERALS.operatorUsername;
      const text = `<meta data-user="${username}"/>`;
      const out = redactPii(text);
      expect(out).not.toContain(username);
      expect(out).toContain('[redacted-username]');
    });

    it('redacts operator account literal anywhere it leaks', () => {
      const acct = OPERATOR_LITERALS.operatorAccount;
      const html = `<span>account: ${acct}</span>`;
      const out = redactPii(html);
      expect(out).not.toContain(acct);
      expect(out).toContain('[redacted-account]');
    });
  });

  describe('urlPathAccountId — REST URL account-id segment', () => {
    it('redacts account id in Discount Titan gatewayAPI URL', () => {
      const acct = OPERATOR_LITERALS.operatorAccount;
      const url = `"url":"/Titan/gatewayAPI/accountDetails/infoAndBalance/${acct}"`;
      const out = redactPii(url);
      expect(out).not.toContain(acct);
      expect(out).toContain('[redacted-account]');
    });

    it('redacts account id followed by trailing path segment', () => {
      const url = '/Titan/gatewayAPI/lastTransactions/transactions/9876543210/forHomePage';
      const out = redactPii(url);
      expect(out).not.toContain('9876543210');
      expect(out).toContain('/[redacted-account]/forHomePage');
    });

    it('leaves non-REST-path numeric strings untouched', () => {
      const text = 'OperationNumber: 1125, Date: 20260521';
      const out = redactPii(text);
      expect(out).toBe(text);
    });
  });
});
