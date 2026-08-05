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

/**
 * `respKeys` names only the envelope, so a successful PayBox wallet fetch
 * digests to `["code","content"]` whatever the rows hold. A blank-payee
 * defect was therefore undiagnosable from logs: nothing named the fields
 * the bank actually sent. These tests pin the row-level diagnostic that
 * closes the gap — names only, values never.
 */
describe('digestResponse row-level field names', () => {
  it('T-DIGEST-12: names the fields of a nested collection', () => {
    const body = JSON.stringify({
      code: 0,
      content: { wallet: [{ id: 7, merchantName: 'x', ts: '2025-01-01' }] },
    });

    const digest = digestResponse(body);

    expect(digest.rowKeys).toEqual(['id', 'merchantName', 'ts']);
  });

  it('T-DIGEST-13: prefers the shallowest collection over a deeper one', () => {
    const body = JSON.stringify({
      items: [{ shallow: 1 }],
      nested: { deeper: [{ deep: 1 }] },
    });

    const digest = digestResponse(body);

    expect(digest.rowKeys).toEqual(['shallow']);
  });

  it('T-DIGEST-14: names row fields of a top-level array body', () => {
    const body = JSON.stringify([{ amount: 1, text: 'y' }]);

    const digest = digestResponse(body);

    expect(digest.rowKeys).toEqual(['amount', 'text']);
  });

  // A field the bank omits on some rows is exactly the signal being hunted,
  // so a single-row sample would hide it.
  it('T-DIGEST-15: unions fields that only some sampled rows carry', () => {
    const body = JSON.stringify({ rows: [{ a: 1 }, { b: 2 }, { c: 3 }] });

    const digest = digestResponse(body);

    expect(digest.rowKeys).toEqual(['a', 'b', 'c']);
  });

  it('T-DIGEST-16: never emits row values, only row field names', () => {
    const body = JSON.stringify({
      content: { wallet: [{ merchantName: 'דני כהן', phone: '0501234567' }] },
    });

    const digest = digestResponse(body);
    const emitted = JSON.stringify(digest);

    expect(digest.rowKeys).toEqual(['merchantName', 'phone']);
    expect(emitted).not.toContain('דני כהן');
    expect(emitted).not.toContain('0501234567');
  });

  // A payload keyed by account number would otherwise leak that number
  // through its key names alone. A short numeric key is just as
  // identifying (a card suffix) and carries no schema information.
  it('T-DIGEST-17: drops bare numeric field names of any length', () => {
    const body = JSON.stringify({ rows: [{ '12345678': 1, '1234': 2, label: 'ok' }] });

    const digest = digestResponse(body);

    expect(digest.rowKeys).toEqual(['label']);
  });

  it('T-DIGEST-18: stays empty when the body carries no collection', () => {
    const digest = digestResponse(PAYBOX_REJECTION);

    expect(digest.rowKeys).toEqual([]);
  });

  it('T-DIGEST-19: ignores an array of scalars', () => {
    const body = JSON.stringify({ codes: [1, 2, 3] });

    const digest = digestResponse(body);

    expect(digest.rowKeys).toEqual([]);
  });

  it('T-DIGEST-20: bounds how many field names a wide row can emit', () => {
    const wideEntries = Array.from({ length: 60 }, (_unused, i) => [
      `f${String(i).padStart(3, '0')}`,
      i,
    ]);
    const wideRow = Object.fromEntries(wideEntries) as Record<string, number>;
    const body = JSON.stringify({ rows: [wideRow] });

    const digest = digestResponse(body);

    expect(digest.rowKeys).toHaveLength(40);
  });

  // Every other fixture happens to declare its keys alphabetically, so
  // the sorted contract would survive removing the sort. This one cannot.
  it('T-DIGEST-21: sorts field names regardless of declaration order', () => {
    const body = JSON.stringify({ rows: [{ zeta: 1, alpha: 2 }, { mid: 3 }] });

    const digest = digestResponse(body);

    expect(digest.rowKeys).toEqual(['alpha', 'mid', 'zeta']);
  });

  // Keys are only safe to log while they are SCHEMA. A body keyed by a
  // value — a phone number, an account reference — turns the key space
  // into the data space, and dropping bare digits alone does not catch it.
  it('T-DIGEST-22: drops keys that are not identifier-shaped', () => {
    const body = JSON.stringify({ rows: [{ '050-123-4567': 1, 'a b': 2, label: 3, _id: 4 }] });

    const digest = digestResponse(body);

    expect(digest.rowKeys).toEqual(['_id', 'label']);
  });

  it('T-DIGEST-23: drops an over-long key rather than logging it', () => {
    const body = JSON.stringify({ rows: [{ [`k${'x'.repeat(60)}`]: 1, ok: 2 }] });

    const digest = digestResponse(body);

    expect(digest.rowKeys).toEqual(['ok']);
  });
});
