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
    negative: 'office 03-1234567 stays',
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
    key: 'cookieAuthValue',
    positive: 'Set-Cookie: auth=zxcvbnmasdf1234567890;',
    expected: '[redacted-cookie]',
    negative: 'auth-free cookie',
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
});
