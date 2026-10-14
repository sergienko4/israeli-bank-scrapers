/**
 * Unit tests for `scripts/browser-stack/playwright-versions.mjs`.
 *
 * <p>The watch pairs three playwright-core versions with each Camoufox
 * release: the lockfile one, the highest stable patch of the next minor and
 * npm `latest`. These tests pin that set: numeric patch order, prereleases
 * never listed, duplicates merged with every label kept.
 */

import {
  fetchPackument,
  highestPatch,
  type IPackument,
  nextMinor,
  PACKUMENT_URL,
  playwrightCandidates,
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

  it('[PV-4] lists lockfile, next minor and latest; merges duplicates', () => {
    const doc = packument('1.64.10');
    const rows = playwrightCandidates(doc, '1.63.1', '1.63');
    expect(rows).toEqual([
      { version: '1.63.1', labels: ['lockfile'] },
      { version: '1.64.10', labels: ['next minor 1.64', 'npm latest'] },
    ]);
  });

  it('[PV-5] drops the next-minor row before that minor ships', () => {
    const doc = packument('1.63.1');
    const rows = playwrightCandidates(doc, '1.63.1', '1.64');
    expect(rows).toEqual([{ version: '1.63.1', labels: ['lockfile', 'npm latest'] }]);
  });

  it('[PV-6] never lists a latest tag that is not a stable version', () => {
    const doc = packument('1.65.0-alpha-2026-05-01');
    const rows = playwrightCandidates(doc, '1.63.1', '1.64');
    expect(rows).toEqual([{ version: '1.63.1', labels: ['lockfile'] }]);
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
