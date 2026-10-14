/**
 * Unit tests for `scripts/browser-stack/playwright-versions.mjs`.
 *
 * <p>The watch pairs three playwright-core versions with each Camoufox
 * release: the lockfile one, the highest stable patch of the next minor and
 * what a consumer's install resolves from the library's own `^` range. These
 * tests pin that set: numeric patch order, npm's choice inside the range
 * (`latest` when it satisfies it, else the highest stable that does),
 * prereleases never listed, duplicates merged with every label kept, and any
 * range form other than `^x.y.z` refused.
 */

import { join } from 'node:path';

import {
  caretRange,
  dependencyRange,
  fetchPackument,
  highestPatch,
  type IPackument,
  nextMinor,
  PACKUMENT_URL,
  playwrightCandidates,
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

/**
 * The candidates for a packument, with lockfile 1.63.1 and the test range.
 *
 * @param doc - The packument.
 * @param testedMinor - `playwrightCore.testedMinor`.
 * @returns The candidate rows.
 */
function candidatesOf(
  doc: IPackument,
  testedMinor: string,
): ReturnType<typeof playwrightCandidates> {
  return playwrightCandidates(doc, { locked: '1.63.1', testedMinor, range: RANGE });
}

describe('playwright candidate versions', () => {
  it('[PV-1] names the minor after the tested one', () => {
    const after63 = nextMinor('1.63');
    const after9 = nextMinor('1.9');
    expect(after63).toBe('1.64');
    expect(after9).toBe('1.10');
  });

  it('[PV-2] picks the highest stable patch by number, not by text', () => {
    const highest = highestPatch(VERSIONS, '1.64');
    expect(highest).toBe('1.64.10');
  });

  it('[PV-3] finds no patch when the minor has only prereleases', () => {
    const highest = highestPatch(VERSIONS, '1.65');
    expect(highest).toBeUndefined();
  });

  it('[PV-4] lists lockfile, next minor and the range; merges duplicates', () => {
    const doc = packument('1.64.10');
    const rows = candidatesOf(doc, '1.63');
    expect(rows).toEqual([
      { version: '1.63.1', labels: ['lockfile'] },
      { version: '1.64.10', labels: ['next minor 1.64', 'range ^1.62.0'] },
    ]);
  });

  it('[PV-5] drops the next-minor row before that minor ships', () => {
    const doc = packument('1.63.1');
    const rows = candidatesOf(doc, '1.64');
    expect(rows).toEqual([{ version: '1.63.1', labels: ['lockfile', 'range ^1.62.0'] }]);
  });

  it('[PV-6] never lists a prerelease latest; the range row is the highest stable', () => {
    const doc = packument('1.65.0-alpha-2026-05-01');
    const rows = candidatesOf(doc, '1.64');
    expect(rows).toEqual([
      { version: '1.63.1', labels: ['lockfile'] },
      { version: HIGHEST_IN_RANGE, labels: ['range ^1.62.0'] },
    ]);
  });

  it('[PV-7] reads the abbreviated packument', async () => {
    const doc = packument('1.64.10');
    const body = JSON.stringify(doc);
    const fake = serving(body);
    const read = await fetchPackument(fake);
    expect(read).toEqual(doc);
    expect(fake.calls[0].url).toBe(PACKUMENT_URL);
    expect(fake.calls[0].init.headers).toEqual({ accept: 'application/vnd.npm.install-v1+json' });
  });
});

describe('what a consumer range resolves to', () => {
  it('[PV-8] takes latest when it satisfies the range, even below a higher match', () => {
    const doc = packument('1.63.1');
    const resolved = resolveRange(doc, RANGE);
    expect(resolved).toBe('1.63.1');
  });

  it('[PV-9] takes the highest stable in range when latest is a new major', () => {
    const versions = [...VERSIONS, '2.0.0'];
    const doc = packument('2.0.0', versions);
    const resolved = resolveRange(doc, RANGE);
    expect(resolved).toBe(HIGHEST_IN_RANGE);
  });

  it('[PV-10] never picks a prerelease, even the highest version in range', () => {
    const versions = ['1.62.0', '1.62.1-beta-1', '1.63.0-alpha-1'];
    const doc = packument('1.63.0-alpha-1', versions);
    const resolved = resolveRange(doc, RANGE);
    expect(resolved).toBe('1.62.0');
  });

  it('[PV-11] lists no range row when no stable version satisfies the range', () => {
    const doc = packument('2.0.0', ['1.61.9', '2.0.0']);
    const resolved = resolveRange(doc, RANGE);
    const rows = candidatesOf(doc, '1.63');
    expect(resolved).toBeUndefined();
    expect(rows).toEqual([{ version: '1.63.1', labels: ['lockfile'] }]);
  });

  it.each([
    ['^1.62.0', [1, 62, 0], [2, 0, 0]],
    ['^0.4.1', [0, 4, 1], [0, 5, 0]],
    ['^0.0.3', [0, 0, 3], [0, 0, 4]],
  ])('[PV-12] bounds %s as npm does', (text: string, low: number[], high: number[]) => {
    const range = caretRange(text);
    expect(range).toEqual({ text, low, high });
  });

  it.each(['~1.62.0', '1.62.0', '>=1.62.0', '^1.62', '^1.62.0-beta.1', '^1.62.0 || ^2.0.0', '*'])(
    '[PV-13] refuses %s as RANGE-UNSUPPORTED',
    (text: string) => {
      expect(() => caretRange(text)).toThrow(`RANGE-UNSUPPORTED ${text}`);
    },
  );

  it('[PV-14] supports the range the library declares', () => {
    const root = process.cwd();
    const packagePath = join(root, 'package.json');
    const declared = dependencyRange(packagePath);
    const range = caretRange(declared);
    expect(range.text).toBe(declared);
  });
});
