/**
 * Unit tests for `scripts/browser-stack/camoufox-releases.mjs`.
 *
 * <p>The watch must report the release a consumer install of camoufox-js
 * picks. Every selection case is therefore checked twice: against the
 * expected tag, and against camoufox-js's own `getAsset` run on the same
 * page (its `fetch` stubbed), so the mirror cannot drift from the library.
 * The asset check is camoufox-js's, for this machine's platform.
 */

import { MissingRelease } from '@hieutran094/camoufox-js/dist/exceptions.js';
import { CamoufoxFetcher, OS_NAME } from '@hieutran094/camoufox-js/dist/pkgman.js';
import { jest } from '@jest/globals';

import {
  candidateReleases,
  fetchReleases,
  type IPlatformAssetCheck,
  type IRelease,
  type IReleaseAsset,
  platformAssetCheck,
  RELEASES_URL,
  selectRelease,
} from '../../../../scripts/browser-stack/camoufox-releases.mjs';
import { serving } from '../../Helpers/FakeFetch.js';

/** This machine's `<os>.<arch>`, as camoufox-js names its assets. */
const HERE = `${OS_NAME}.${CamoufoxFetcher.getPlatformArch()}`;

/** A platform no camoufox-js check on this machine accepts. */
const ELSEWHERE = OS_NAME === 'lin' ? 'win.x86_64' : 'lin.x86_64';

/** Stands for "no release": camoufox-js would fail to install. */
const NONE = 'none';

/** Release flags by kind. */
const FLAGS = Object.freeze({
  stable: { prerelease: false, draft: false },
  prerelease: { prerelease: true, draft: false },
  draft: { prerelease: false, draft: true },
});

/**
 * One release asset.
 *
 * @param version - `<version>-<release>` part of the name.
 * @param platform - `<os>.<arch>` part of the name.
 * @returns The asset.
 */
function asset(version: string, platform: string): IReleaseAsset {
  const name = `camoufox-${version}-${platform}.zip`;
  return { name, browser_download_url: `https://example.test/${name}` };
}

/**
 * One release with one asset per platform.
 *
 * @param tag - Release tag.
 * @param kind - Stable, prerelease or draft.
 * @param platforms - `<os>.<arch>` of each asset; empty for none.
 * @returns The release.
 */
function release(
  tag: string,
  kind: keyof typeof FLAGS,
  platforms: readonly string[] = [HERE],
): IRelease {
  const version = tag.slice(1);
  const assets = platforms.map((p): IReleaseAsset => asset(version, p));
  return { tag_name: tag, ...FLAGS[kind], assets };
}

/** One selection case: a releases page and the tag camoufox-js installs from it. */
interface ISelectionCase {
  readonly name: string;
  readonly releases: readonly IRelease[];
  readonly expected: string;
}

/** An asset whose release lies outside the range camoufox-js supports. */
const OUT_OF_RANGE: IRelease = {
  tag_name: 'v200.0.0-beta.1',
  ...FLAGS.stable,
  assets: [asset('200.0-2', HERE)],
};

const CASES: readonly ISelectionCase[] = [
  {
    name: 'skips prereleases and drafts',
    releases: [
      release('v156.0.1-beta.38', 'prerelease'),
      release('v156.0.1-beta.37', 'draft'),
      release('v156.0.1-beta.36', 'stable'),
      release('v156.0.1-beta.34', 'stable'),
    ],
    expected: 'v156.0.1-beta.36',
  },
  {
    name: 'skips a stable release with no asset for this platform',
    releases: [
      release('v156.0.1-beta.36', 'stable', [ELSEWHERE]),
      release('v156.0.1-beta.34', 'stable'),
    ],
    expected: 'v156.0.1-beta.34',
  },
  {
    name: 'skips a stable release with no assets at all',
    releases: [release('v156.0.1-beta.36', 'stable', []), release('v152.0.4-beta.30', 'stable')],
    expected: 'v152.0.4-beta.30',
  },
  {
    name: 'skips an asset outside the range camoufox-js supports',
    releases: [OUT_OF_RANGE, release('v156.0.1-beta.34', 'stable')],
    expected: 'v156.0.1-beta.34',
  },
  {
    name: 'selects none when no stable release on the page has an asset',
    releases: [
      release('v156.0.1-beta.38', 'prerelease'),
      release('v156.0.1-beta.36', 'stable', [ELSEWHERE]),
    ],
    expected: NONE,
  },
];

/**
 * The asset URL camoufox-js's own `getAsset` picks, or {@link NONE} when it finds no release.
 *
 * @returns Download URL.
 */
async function pickedUrl(): Promise<string> {
  const fetcher = new CamoufoxFetcher();
  try {
    const [, url] = (await fetcher.getAsset()) as readonly [unknown, string];
    return url;
  } catch (error) {
    if (error instanceof MissingRelease) return NONE;
    throw error;
  }
}

/**
 * The tag camoufox-js's own `getAsset` installs from `releases`, or {@link NONE}.
 *
 * @param releases - The page its `fetch` returns.
 * @returns Release tag.
 */
async function installedBy(releases: readonly IRelease[]): Promise<string> {
  const body = JSON.stringify(releases);
  jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
    const response = new Response(body, { status: 200 });
    return Promise.resolve(response);
  });
  const url = await pickedUrl();
  const owner = releases.find(r => r.assets.some(a => a.browser_download_url === url));
  return owner?.tag_name ?? NONE;
}

/**
 * The tag {@link selectRelease} picks for this machine, or {@link NONE}.
 *
 * @param releases - The releases page.
 * @param check - camoufox-js's asset check.
 * @returns Release tag.
 */
function selectedBy(releases: readonly IRelease[], check: IPlatformAssetCheck): string {
  return selectRelease(releases, check.acceptsAsset) ?? NONE;
}

describe('selectRelease', () => {
  let check: IPlatformAssetCheck;

  beforeAll(async () => {
    check = await platformAssetCheck();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('[CR-1] checks assets for this machine', () => {
    const label = HERE.replace('.', ' ');
    expect(check.platform).toBe(label);
  });

  it.each(CASES)('[CR-2] $name', ({ releases, expected }) => {
    const selected = selectedBy(releases, check);
    expect(selected).toBe(expected);
  });

  it('[CR-3] returns null, not a tag, when camoufox-js would fail', () => {
    const page = [release('v156.0.1-beta.36', 'stable', [ELSEWHERE])];
    const selected = selectRelease(page, check.acceptsAsset);
    expect(selected).toBeNull();
  });

  it.each(CASES)('[CR-4] agrees with camoufox-js getAsset: $name', async ({ releases }) => {
    const installed = await installedBy(releases);
    const selected = selectedBy(releases, check);
    expect(selected).toBe(installed);
  });
});

describe('candidateReleases', () => {
  it('[CR-5] lists the ten newest version tags and drops other tags', () => {
    const versions = Array.from({ length: 12 }, (_, i): IRelease => {
      const kind = i % 2 === 0 ? 'prerelease' : 'stable';
      return release(`v156.0.1-beta.${String(40 - i)}`, kind);
    });
    const page = [versions[0], release('font-bundle-v1', 'stable'), ...versions.slice(1)];
    const rows = candidateReleases(page);
    const [first, second] = rows;
    const tags = rows.map(r => r.tag);
    expect(rows).toHaveLength(10);
    expect([first, second]).toEqual([
      { tag: 'v156.0.1-beta.40', prerelease: true },
      { tag: 'v156.0.1-beta.39', prerelease: false },
    ]);
    expect(tags).not.toContain('font-bundle-v1');
  });
});

describe('fetchReleases', () => {
  it('[CR-6] reads the page camoufox-js reads and sends the token as a bearer', async () => {
    const page = [release('v156.0.1-beta.36', 'stable')];
    const body = JSON.stringify(page);
    const fake = serving(body);
    const releases = await fetchReleases({ GITHUB_TOKEN: 'token-1' }, fake);
    expect(releases).toEqual(page);
    expect(fake.calls[0].url).toBe(RELEASES_URL);
    expect(fake.calls[0].init.headers).toMatchObject({ authorization: 'Bearer token-1' });
  });

  it('[CR-7] sends no authorization without a token', async () => {
    const fake = serving('[]');
    await fetchReleases({}, fake);
    expect(fake.calls[0].init.headers).not.toHaveProperty('authorization');
  });

  it('[CR-8] refuses a body that is not a list', async () => {
    const fake = serving('{"message":"Not Found"}');
    const fetching = fetchReleases({}, fake);
    await expect(fetching).rejects.toThrow('is not a list of releases');
  });
});
