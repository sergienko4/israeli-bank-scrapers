/**
 * Unit tests for StatefulRewriter.
 *
 * Pins the sequence-aware semantics:
 *
 * - Same `(method, canonical-url)` hit twice → returns entries in
 *   chronological order (1st hit = entries[0], 2nd hit = entries[1]).
 * - Exhausted bucket → None + bumps `exhaustedCount`.
 * - Unknown URL → None + bumps `missCount` (does NOT bump `exhaustedCount`).
 * - Default URL canonicalizer strips `?query` and `#fragment`.
 * - Custom canonicalizer is honoured.
 */

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import { isSome } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IHarEntry } from '../../../Integration/Simulator/HarTypes.js';
import {
  createStatefulRewriter,
  defaultUrlKey,
} from '../../../Integration/Simulator/StatefulRewriter.js';

/**
 * Build a synthetic 200 OK HAR response wrapping `bodyTag`.
 *
 * @param bodyTag - Body text used as the response's identifying marker.
 * @returns Minimal valid HAR response.
 */
function makeResponse(bodyTag: string): IHarEntry['response'] {
  return {
    status: 200,
    statusText: 'OK',
    headers: [],
    content: { mimeType: 'text/plain', text: bodyTag },
  };
}

/**
 * Build a synthetic HAR entry with the given identifying response body.
 *
 * @param method - HTTP method.
 * @param url - Raw URL (search/fragment OK).
 * @param bodyTag - Tag stored in `response.content.text` for assertions.
 * @returns Minimal valid HAR entry.
 */
function makeEntry(method: string, url: string, bodyTag: string): IHarEntry {
  return {
    request: { method, url, headers: [], queryString: [] },
    response: makeResponse(bodyTag),
  };
}

/**
 * Unwrap an {@link Option} or fail the test with a stable error.
 *
 * @param opt - Option value (`{ has, value? }` discriminated union).
 * @param opt.has - True iff `value` is set.
 * @param opt.value - Wrapped value (only inspected when `has` is true).
 * @returns The wrapped value.
 */
function unwrapSomeOrFail<T>(opt: { has: boolean; value?: T }): T {
  if (!opt.has || opt.value === undefined) throw new ScraperError('expected Some, got None');
  return opt.value;
}

/**
 * Canonicalizer that maps every URL to the same key (test double).
 *
 * @returns Constant string used as the bucket key for all requests.
 */
function fixedKeyCanonicalizer(): string {
  return 'fixed-key';
}

describe('StatefulRewriter', () => {
  describe('defaultUrlKey', () => {
    it('strips query + fragment', () => {
      const key = defaultUrlKey('https://bank.example/api/x?session=abc#part');
      expect(key).toBe('https://bank.example/api/x');
    });

    it('falls back to raw url on parse failure', () => {
      const key = defaultUrlKey('not://a parseable url');
      expect(key).toBe('not://a parseable url');
    });
  });

  describe('pick — sequence ordering', () => {
    it('returns entries in chronological order for same URL', () => {
      const a = makeEntry('GET', 'https://b.example/s', 'first');
      const b = makeEntry('GET', 'https://b.example/s', 'second');
      const rewriter = createStatefulRewriter({ entries: [a, b] });
      const hit1 = rewriter.pick({ method: 'GET', url: 'https://b.example/s' });
      const hit2 = rewriter.pick({ method: 'GET', url: 'https://b.example/s' });
      const e1 = unwrapSomeOrFail(hit1);
      const e2 = unwrapSomeOrFail(hit2);
      expect(e1.response.content.text).toBe('first');
      expect(e2.response.content.text).toBe('second');
    });

    it('returns None and bumps exhaustedCount after bucket runs out', () => {
      const a = makeEntry('GET', 'https://b.example/s', 'only');
      const rewriter = createStatefulRewriter({ entries: [a] });
      rewriter.pick({ method: 'GET', url: 'https://b.example/s' });
      const exhausted = rewriter.pick({ method: 'GET', url: 'https://b.example/s' });
      const snap = rewriter.snapshot();
      const isExhaustedNone = isSome(exhausted);
      expect(isExhaustedNone).toBe(false);
      expect(snap.exhaustedCount).toBe(1);
      expect(snap.missCount).toBe(0);
    });
  });

  describe('pick — miss handling', () => {
    it('returns None and bumps missCount on unknown URL', () => {
      const a = makeEntry('GET', 'https://b.example/s', 'tag');
      const rewriter = createStatefulRewriter({ entries: [a] });
      const result = rewriter.pick({ method: 'GET', url: 'https://b.example/UNKNOWN' });
      const snap = rewriter.snapshot();
      const hasMatch = isSome(result);
      expect(hasMatch).toBe(false);
      expect(snap.missCount).toBe(1);
      expect(snap.exhaustedCount).toBe(0);
    });

    it('does NOT match cross-method (POST → GET)', () => {
      const a = makeEntry('POST', 'https://b.example/s', 'post');
      const rewriter = createStatefulRewriter({ entries: [a] });
      const wrong = rewriter.pick({ method: 'GET', url: 'https://b.example/s' });
      const snap = rewriter.snapshot();
      const hasMatch = isSome(wrong);
      expect(hasMatch).toBe(false);
      expect(snap.missCount).toBe(1);
    });
  });

  describe('canonicalization', () => {
    it('matches across differing query strings by default', () => {
      const a = makeEntry('GET', 'https://b.example/s?session=alice', 'one');
      const rewriter = createStatefulRewriter({ entries: [a] });
      const hit = rewriter.pick({ method: 'GET', url: 'https://b.example/s?session=bob' });
      const snap = rewriter.snapshot();
      const hasMatch = isSome(hit);
      expect(hasMatch).toBe(true);
      expect(snap.missCount).toBe(0);
    });

    it('uses a custom canonicalizer when provided', () => {
      const a = makeEntry('GET', 'https://b.example/s?x=1', 'one');
      const rewriter = createStatefulRewriter({
        entries: [a],
        urlCanonicalizer: fixedKeyCanonicalizer,
      });
      const hit = rewriter.pick({ method: 'GET', url: 'https://totally-different.example/y' });
      const hasMatch = isSome(hit);
      expect(hasMatch).toBe(true);
    });
  });

  describe('snapshot', () => {
    it('reports per-key hit counts', () => {
      const a = makeEntry('GET', 'https://b.example/s', 'tag');
      const b = makeEntry('POST', 'https://b.example/p', 'tag2');
      const rewriter = createStatefulRewriter({ entries: [a, b] });
      rewriter.pick({ method: 'GET', url: 'https://b.example/s' });
      rewriter.pick({ method: 'POST', url: 'https://b.example/p' });
      const snap = rewriter.snapshot();
      const getHits = snap.hits.get('GET https://b.example/s');
      const postHits = snap.hits.get('POST https://b.example/p');
      expect(getHits).toBe(1);
      expect(postHits).toBe(1);
    });

    it('hits map is a defensive copy (mutating it does not change rewriter state)', () => {
      const a = makeEntry('GET', 'https://b.example/s', 'tag');
      const rewriter = createStatefulRewriter({ entries: [a] });
      rewriter.pick({ method: 'GET', url: 'https://b.example/s' });
      const snapBefore = rewriter.snapshot();
      const mutable = snapBefore.hits as Map<string, number>;
      mutable.set('GET https://b.example/s', 999);
      const snapAfter = rewriter.snapshot();
      const afterCount = snapAfter.hits.get('GET https://b.example/s');
      expect(afterCount).toBe(1);
    });
  });
});
