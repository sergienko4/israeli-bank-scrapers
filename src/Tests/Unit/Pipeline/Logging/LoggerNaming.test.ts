/**
 * Unit tests for `Logging/LoggerNaming.deriveLogName` — pure
 * URL→kebab transformation, no pino instantiation.
 */

import { deriveLogName } from '../../../../Scrapers/Pipeline/Logging/LoggerNaming.js';

describe('Feature — deriveLogName', () => {
  it('kebab-cases a PascalCase basename (.ts)', () => {
    const name = deriveLogName('file:///abs/Mediator/Elements/ActionExecutors.ts');
    expect(name).toBe('action-executors');
  });

  it('strips .js / .mjs / .cjs / .jsx / .tsx extensions equally', () => {
    const js = deriveLogName('file:///a/Foo.js');
    const mjs = deriveLogName('file:///a/Foo.mjs');
    const cjs = deriveLogName('file:///a/Foo.cjs');
    const tsx = deriveLogName('file:///a/Foo.tsx');
    const jsx = deriveLogName('file:///a/Foo.jsx');
    expect(js).toBe('foo');
    expect(mjs).toBe('foo');
    expect(cjs).toBe('foo');
    expect(tsx).toBe('foo');
    expect(jsx).toBe('foo');
  });

  it('drops querystring and fragment from the URL', () => {
    const name = deriveLogName('file:///a/MyMod.ts?cache=1#frag');
    expect(name).toBe('my-mod');
  });

  it('returns the input verbatim when no path separators are present', () => {
    const name = deriveLogName('LeumiScraper');
    expect(name).toBe('leumi-scraper');
  });

  it('handles consecutive capitals deterministically', () => {
    const name = deriveLogName('file:///x/HTTPClient.ts');
    expect(name).toBe('httpclient');
  });

  it('preserves digit boundaries already separated from letters', () => {
    const name = deriveLogName('file:///x/V2Adapter.ts');
    expect(name).toBe('v2-adapter');
  });
});
