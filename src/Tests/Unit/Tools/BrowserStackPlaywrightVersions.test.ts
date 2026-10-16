/**
 * Unit tests for `scripts/browser-stack/playwright-versions.mjs`.
 *
 * <p>The watch pairs the playwright-core version a consumer's install resolves
 * from the library's own `^` range with the Camoufox release camoufox-js
 * installs. These tests pin that version: npm's choice inside the range
 * (`latest` when it satisfies it, else the highest stable that does, by
 * number rather than text), prereleases never chosen, and any range form
 * other than `^x.y.z` refused.
 */

import { join } from 'node:path';

import {
  caretRange,
  dependencyRange,
  fetchPackument,
  type IPackument,
  PACKUMENT_URL,
  resolveRange,
} from '../../../../scripts/browser-stack/playwright-versions.mjs';
import { serving } from '../../Helpers/FakeFetch.js';

/** Published versions: two minors, prereleases, and a two-digit patch. */
const VERSIONS = [
  '1.63.0',
  '1.63.1',
  '1.64.0',
  '1.64.2',
  '1.64.10',
  '1.64.11-beta-1780000000000',
  '1.65.0-alpha-2026-05-01',
];

/** The library's range in these tests. */
const RANGE = caretRange('^1.62.0');

/** What `^1.62.0` resolves to among {@link VERSIONS} when `latest` is not in it. */
const HIGHEST_IN_RANGE = '1.64.10';

/**
 * An abbreviated packument with `versions` and a `latest` dist-tag.
 *
 * @param latest - The `latest` dist-tag.
 * @param versions - Published versions.
 * @returns The packument.
 */
function packument(latest: string, versions: readonly string[] = VERSIONS): IPackument {
  const entries = versions.map((v): [string, object] => [v, {}]);
  return { 'dist-tags': { latest }, versions: Object.fromEntries(entries) };
}

describe('playwright-core packument', () => {
  it('[PV-1] reads the abbreviated packument', async () => {
    const doc = packument('1.64.10');
    const body = JSON.stringify(doc);
    const fake = serving(body);
    const read = await fetchPackument(fake);
    expect(read).toEqual(doc);
    expect(fake.calls[0].url).toBe(PACKUMENT_URL);
    expect(fake.calls[0].init.headers).toEqual({ accept: 'application/vnd.npm.install-v1+json' });
  });

  it.each([
    ['an empty object', '{}'],
    ['versions as a list', '{"dist-tags":{"latest":"1.64.1"},"versions":[]}'],
    ['no latest tag', '{"dist-tags":{},"versions":{}}'],
    ['a numeric latest tag', '{"dist-tags":{"latest":1},"versions":{}}'],
    ['an empty version map', '{"dist-tags":{"latest":"1.64.1"},"versions":{}}'],
    ['latest missing from versions', '{"dist-tags":{"latest":"1.64.1"},"versions":{"1.63.0":{}}}'],
    ['a list', '[]'],
    ['null', 'null'],
  ])('[PV-9] refuses %s as a packument', async (_name, body) => {
    const fake = serving(body);
    const reading = fetchPackument(fake);
    await expect(reading).rejects.toThrow(`${PACKUMENT_URL} is not a packument`);
    await expect(reading).rejects.toHaveProperty('name', 'FetchFailedError');
  });

  it('[PV-10] refuses a body that is not JSON', async () => {
    const fake = serving('<html>');
    const reading = fetchPackument(fake);
    await expect(reading).rejects.toThrow(`${PACKUMENT_URL} is not JSON`);
  });
});

describe('what a consumer range resolves to', () => {
  it('[PV-2] takes latest when it satisfies the range, even below a higher match', () => {
    const doc = packument('1.63.1');
    const resolved = resolveRange(doc, RANGE);
    expect(resolved).toBe('1.63.1');
  });

  it('[PV-3] takes the highest stable in range when latest is a new major', () => {
    const versions = [...VERSIONS, '2.0.0'];
    const doc = packument('2.0.0', versions);
    const resolved = resolveRange(doc, RANGE);
    expect(resolved).toBe(HIGHEST_IN_RANGE);
  });

  it('[PV-4] never picks a prerelease, even the highest version in range', () => {
    const versions = ['1.62.0', '1.62.1-beta-1', '1.63.0-alpha-1'];
    const doc = packument('1.63.0-alpha-1', versions);
    const resolved = resolveRange(doc, RANGE);
    expect(resolved).toBe('1.62.0');
  });

  it('[PV-5] resolves nothing when no stable version satisfies the range', () => {
    const doc = packument('2.0.0', ['1.61.9', '2.0.0']);
    const resolved = resolveRange(doc, RANGE);
    expect(resolved).toBeUndefined();
  });

  it.each([
    ['^1.62.0', [1, 62, 0], [2, 0, 0]],
    ['^0.4.1', [0, 4, 1], [0, 5, 0]],
    ['^0.0.3', [0, 0, 3], [0, 0, 4]],
  ])('[PV-6] bounds %s as npm does', (text: string, low: number[], high: number[]) => {
    const range = caretRange(text);
    expect(range).toEqual({ text, low, high });
  });

  it.each(['~1.62.0', '1.62.0', '>=1.62.0', '^1.62', '^1.62.0-beta.1', '^1.62.0 || ^2.0.0', '*'])(
    '[PV-7] refuses %s as RANGE-UNSUPPORTED',
    (text: string) => {
      expect(() => caretRange(text)).toThrow(`RANGE-UNSUPPORTED ${text}`);
    },
  );

  it('[PV-8] supports the range the library declares', () => {
    const root = process.cwd();
    const packagePath = join(root, 'package.json');
    const declared = dependencyRange(packagePath);
    const range = caretRange(declared);
    expect(range.text).toBe(declared);
  });
});
