/**
 * Unit tests for PiiRedactor — sanitises bank-fixture HTML/JSON.
 */

import {
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
    positive: '<div><h1>שלום</h1><p>[REDACTED-HE-SURNAME] [REDACTED-HE-NAME]</p></div>',
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
    positive: 'account [REDACTED-ACCT] here',
    expected: '[redacted-account]',
    negative: 'date 2024-12-26 stays',
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
      const html = '<div class="mobile-user-title"><h1>שלום</h1><p>[REDACTED-HE-SURNAME] [REDACTED-HE-NAME]</p></div>';
      const out = redactPii(html);
      expect(out).not.toContain('[REDACTED-HE-SURNAME]');
      expect(out).toContain('[redacted-name]');
    });

    it('redacts name in <h1 id="main-title">שלום</h1><p>NAME</p>', () => {
      const html =
        '<section><h1 id="main-title" tabindex="0">שלום</h1><p>[REDACTED-HE-SURNAME] [REDACTED-HE-NAME]</p></section>';
      const out = redactPii(html);
      expect(out).not.toContain('[REDACTED-HE-SURNAME]');
      expect(out).toContain('[redacted-name]');
    });
  });

  describe('jsonPersonNameField — bank API response name fields', () => {
    it('redacts partyFullName in JSON object', () => {
      const json = '{"partyFullName": "[REDACTED-HE-SURNAME] יוג\'ין", "id": 1}';
      const out = redactPii(json);
      expect(out).not.toContain('[REDACTED-HE-SURNAME]');
      expect(out).toContain('[redacted-name]');
    });

    it('redacts partyFirstName in escaped NDJSON envelope', () => {
      const ndjson = '{"envelope":"{\\"partyFirstName\\": \\"יוג\'ין\\"}"}';
      const out = redactPii(ndjson);
      expect(out).not.toContain('יוג');
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
      const html = '<span>העברה מ[REDACTED-HE-NAME] [REDACTED-HE-SURNAME] חשבון</span>';
      const out = redactPii(html);
      expect(out).not.toContain('[REDACTED-HE-SURNAME]');
      expect(out).not.toContain('[REDACTED-HE-NAME]');
      expect(out).toContain('[redacted-name]');
    });

    it('redacts English operator names in HTML/JSON', () => {
      const html = '<span>From [REDACTED-USER], Yevgeny</span>';
      const out = redactPii(html);
      expect(out).not.toMatch(/[REDACTED-USER]|Yevgeny/i);
      expect(out).toContain('[redacted-name]');
    });

    it('redacts operator username VT75151 anywhere it leaks', () => {
      const text = '<meta data-user="VT75151"/>';
      const out = redactPii(text);
      expect(out).not.toContain('VT75151');
      expect(out).toContain('[redacted-username]');
    });

    it('redacts operator account literal [REDACTED-OPER-ACCT]', () => {
      const html = '<span>account: [REDACTED-OPER-ACCT]</span>';
      const out = redactPii(html);
      expect(out).not.toContain('[REDACTED-OPER-ACCT]');
      expect(out).toContain('[redacted-account]');
    });
  });

  describe('urlPathAccountId — REST URL account-id segment', () => {
    it('redacts account id in Discount Titan gatewayAPI URL', () => {
      const url = '"url":"/Titan/gatewayAPI/accountDetails/infoAndBalance/[REDACTED-OPER-ACCT]"';
      const out = redactPii(url);
      expect(out).not.toContain('[REDACTED-OPER-ACCT]');
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
