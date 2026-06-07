/**
 * Unit tests for HarToMirrorManifest.
 *
 * Pins the bridge contract:
 *
 * - Each well-formed HAR entry projects to exactly one row.
 * - Unsupported HTTP methods (e.g. `CONNECT`) are dropped silently.
 * - URLs are canonicalized (query + fragment stripped).
 * - Duplicate response headers are joined with ", ".
 * - `Content-Type` resolves header → mimeType → octet-stream fallback.
 * - Base64-encoded bodies surface `inlineBodyEncoding: 'base64'`.
 * - `bodyFile` is intentionally left empty (operator fills it after
 *   writing body to disk).
 */

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import { isSome } from '../../../../Scrapers/Pipeline/Types/Option.js';
import {
  canonicalUrl,
  flattenHeaders,
  toManifestRow,
  toManifestRows,
} from '../../../Integration/Simulator/HarToMirrorManifest.js';
import type { IHarEntry } from '../../../Integration/Simulator/HarTypes.js';

/** Spec for {@link buildEntry}. */
interface IBuildEntrySpec {
  readonly method: string;
  readonly url: string;
  readonly body?: string;
  readonly encoding?: 'base64';
  readonly mimeType?: string;
  readonly contentType?: string;
  readonly status?: number;
  readonly extraHeaders?: readonly { name: string; value: string }[];
}

/**
 * Build the response headers array for a synthetic HAR entry.
 *
 * @param spec - Entry spec.
 * @returns Headers array (may be empty).
 */
function buildResponseHeaders(spec: IBuildEntrySpec): readonly { name: string; value: string }[] {
  const ct =
    spec.contentType === undefined ? [] : [{ name: 'Content-Type', value: spec.contentType }];
  const extra = spec.extraHeaders ?? [];
  return [...ct, ...extra];
}

/**
 * Build a synthetic HAR entry.
 *
 * @param spec - Method / URL / body / encoding / contentType / extra headers.
 * @returns Minimal HAR entry.
 */
function buildEntry(spec: IBuildEntrySpec): IHarEntry {
  const headers = buildResponseHeaders(spec);
  const content = { mimeType: spec.mimeType ?? '', text: spec.body, encoding: spec.encoding };
  const status = spec.status ?? 200;
  return {
    request: { method: spec.method, url: spec.url, headers: [], queryString: [] },
    response: { status, statusText: 'OK', headers, content },
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

describe('HarToMirrorManifest', () => {
  describe('canonicalUrl', () => {
    it('strips query + fragment', () => {
      const result = canonicalUrl('https://b.example/api?x=1#z');
      expect(result).toBe('https://b.example/api');
    });

    it('falls back to raw string when URL parse fails', () => {
      const result = canonicalUrl('::bad::');
      expect(result).toBe('::bad::');
    });
  });

  describe('flattenHeaders', () => {
    it('lower-cases header names', () => {
      const map = flattenHeaders([{ name: 'X-Custom', value: 'v' }]);
      const lower = map.get('x-custom');
      const original = map.get('X-Custom');
      expect(lower).toBe('v');
      expect(original).toBeUndefined();
    });

    it('joins duplicate header values with comma-space', () => {
      const map = flattenHeaders([
        { name: 'Set-Cookie', value: 'a=1' },
        { name: 'set-cookie', value: 'b=2' },
      ]);
      const joined = map.get('set-cookie');
      expect(joined).toBe('a=1, b=2');
    });
  });

  describe('toManifestRow — happy path', () => {
    it('projects GET with explicit Content-Type', () => {
      const entry = buildEntry({
        method: 'GET',
        url: 'https://b.example/api?x=1',
        body: '{"ok":true}',
        contentType: 'application/json',
      });
      const opt = toManifestRow(entry);
      const row = unwrapSomeOrFail(opt);
      expect(row.method).toBe('GET');
      expect(row.urlPattern).toBe('https://b.example/api');
      expect(row.response.contentType).toBe('application/json');
      expect(row.response.bodyFile).toBe('');
      expect(row.inlineBody).toBe('{"ok":true}');
      expect(row.inlineBodyEncoding).toBe('utf8');
    });

    it('uppercases lowercase method', () => {
      const entry = buildEntry({ method: 'post', url: 'https://b.example/x' });
      const opt = toManifestRow(entry);
      const row = unwrapSomeOrFail(opt);
      expect(row.method).toBe('POST');
    });

    it('falls back to content.mimeType when no header', () => {
      const entry = buildEntry({ method: 'GET', url: 'https://b.example/x', mimeType: 'text/css' });
      const opt = toManifestRow(entry);
      const row = unwrapSomeOrFail(opt);
      expect(row.response.contentType).toBe('text/css');
    });

    it('falls back to application/octet-stream when nothing known', () => {
      const entry = buildEntry({ method: 'GET', url: 'https://b.example/x' });
      const opt = toManifestRow(entry);
      const row = unwrapSomeOrFail(opt);
      expect(row.response.contentType).toBe('application/octet-stream');
    });

    it('marks base64 bodies', () => {
      const entry = buildEntry({
        method: 'GET',
        url: 'https://b.example/img',
        body: 'BASE64DATA',
        encoding: 'base64',
        contentType: 'image/png',
      });
      const opt = toManifestRow(entry);
      const row = unwrapSomeOrFail(opt);
      expect(row.inlineBodyEncoding).toBe('base64');
      expect(row.inlineBody).toBe('BASE64DATA');
    });
  });

  describe('toManifestRow — rejection', () => {
    it('drops unsupported method (CONNECT)', () => {
      const entry = buildEntry({ method: 'CONNECT', url: 'https://b.example/' });
      const row = toManifestRow(entry);
      const hasMatch = isSome(row);
      expect(hasMatch).toBe(false);
    });
  });

  describe('toManifestRows', () => {
    it('keeps supported entries, drops unsupported', () => {
      const supported = buildEntry({ method: 'GET', url: 'https://b.example/a' });
      const unsupported = buildEntry({ method: 'CONNECT', url: 'https://b.example/proxy' });
      const rows = toManifestRows([supported, unsupported]);
      const firstMethod = rows[0].method;
      expect(rows.length).toBe(1);
      expect(firstMethod).toBe('GET');
    });

    it('preserves chronological order', () => {
      const first = buildEntry({ method: 'GET', url: 'https://b.example/one' });
      const second = buildEntry({ method: 'POST', url: 'https://b.example/two' });
      const rows = toManifestRows([first, second]);
      const urls = rows.map(r => r.urlPattern);
      expect(urls).toEqual(['https://b.example/one', 'https://b.example/two']);
    });
  });
});
