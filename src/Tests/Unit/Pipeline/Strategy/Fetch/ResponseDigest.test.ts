/**
 * Contract tests for the PII-safe api-direct response digest.
 *
 * <p>The digest exists because scrape-phase fetches previously logged
 * only `verb`/`url`/`status`, which cannot distinguish "worked" from
 * "bank rejected the request body" — PayBox returns app-level errors
 * as `{code, name, message, explanation}`, sometimes under HTTP 200.
 *
 * <p>The load-bearing test here is T-DIGEST-6: `message` and
 * `explanation` are free-text and can embed customer data, so they must
 * never reach a log line. That is asserted structurally (no value of
 * either field appears anywhere in the digest), not by naming fields.
 */
import { digestResponse } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/ResponseDigest.js';

const PAYBOX_REJECTION = JSON.stringify({
  code: 4001,
  name: 'INVALID_REQUEST',
  message: 'החשבון של דני כהן 0501234567 נכשל',
  explanation: 'account ***97f6 signature mismatch',
});

const PAYBOX_OK = JSON.stringify({ code: 0, content: { wallet: [] } });

describe('digestResponse', () => {
  it('T-DIGEST-1: reports byte length of the raw body', () => {
    const digest = digestResponse('abcde');

    expect(digest.respLength).toBe(5);
  });

  it('T-DIGEST-2: surfaces top-level key names for shape diagnosis', () => {
    const digest = digestResponse(PAYBOX_OK);

    expect(digest.respKeys).toEqual(['code', 'content']);
  });

  it('T-DIGEST-3: surfaces the bank app-level error code and name', () => {
    const digest = digestResponse(PAYBOX_REJECTION);

    expect(digest.errorCode).toBe('4001');
    expect(digest.errorName).toBe('INVALID_REQUEST');
  });

  it('T-DIGEST-4: leaves error identifiers blank on a clean payload', () => {
    const clean = JSON.stringify({ content: {} });

    const digest = digestResponse(clean);

    expect(digest.errorCode).toBe('');
    expect(digest.errorName).toBe('');
  });

  it('T-DIGEST-5: still reports length when the body is not JSON', () => {
    const html = '<html><body>Access denied</body></html>';
    const digest = digestResponse(html);

    expect(digest.respLength).toBe(html.length);
    expect(digest.respKeys).toEqual([]);
  });

  it('T-DIGEST-6: never emits free-text message or explanation values', () => {
    const digest = digestResponse(PAYBOX_REJECTION);
    const emitted = JSON.stringify(digest);

    expect(emitted).not.toContain('דני כהן');
    expect(emitted).not.toContain('0501234567');
    expect(emitted).not.toContain('signature mismatch');
    expect(emitted).not.toContain('97f6');
  });

  it('T-DIGEST-7: ignores non-scalar code and name values', () => {
    const nonScalar = JSON.stringify({ code: { nested: 1 }, name: ['x'] });

    const digest = digestResponse(nonScalar);

    expect(digest.errorCode).toBe('');
    expect(digest.errorName).toBe('');
  });

  it('T-DIGEST-8: treats a JSON array body as having no top-level fields', () => {
    const arrayBody = JSON.stringify([{ code: 4001 }]);

    const digest = digestResponse(arrayBody);

    expect(digest.respKeys).toEqual([]);
    expect(digest.errorCode).toBe('');
  });

  it('T-DIGEST-9: tolerates a bare null body', () => {
    const digest = digestResponse('null');

    expect(digest.respKeys).toEqual([]);
    expect(digest.respLength).toBe(4);
  });

  it('T-DIGEST-10: tolerates an empty body', () => {
    const digest = digestResponse('');

    expect(digest.respLength).toBe(0);
    expect(digest.respKeys).toEqual([]);
  });

  // Hebrew is the common case for Israeli-bank error envelopes, and it is
  // exactly where UTF-16 code units and UTF-8 bytes diverge: reporting the
  // code-unit count makes a substantial rejection body read as roughly
  // half its wire size, which is how a real error page can be mistaken
  // for an empty one.
  it('T-DIGEST-11: reports UTF-8 bytes, not UTF-16 code units', () => {
    const hebrewBody = JSON.stringify({ code: 4001, message: 'שגיאה' });
    const expectedBytes = Buffer.byteLength(hebrewBody, 'utf8');

    const digest = digestResponse(hebrewBody);

    expect(digest.respLength).toBe(expectedBytes);
    expect(digest.respLength).toBeGreaterThan(hebrewBody.length);
  });
});
