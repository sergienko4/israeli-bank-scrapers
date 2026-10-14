/**
 * Unit test for `.github/actions/install-camoufox/install.sh`.
 *
 * <p>The script is the one Camoufox installer shared by the CI composite
 * action and the Docker CI mirror. Its contract: install exactly the tag pinned in
 * `browser-stack.json` into the directory camoufox-js launches from, on every
 * run, from asset bytes that hash to the pinned SHA-256, trusting no install
 * already on disk; use a kept asset (`CAMOUFOX_ASSET_DIR`) only when it
 * hashes to the pin, else download the pin exactly once and never through
 * `camoufox-js fetch` (which resolves its own newest release, not the pin);
 * use `gh` only when a token exists (CI) and the public release URL
 * otherwise (Docker); keep a verified download, replacing whatever a
 * restored cache left at its name, and report `downloaded` for the action's
 * cache save; extract into a staging dir and swap it in only after the
 * binary checks out, so a failed run keeps the previous install; put the
 * previous install back when a run fails or is stopped after setting it
 * aside but before the staged tree is renamed in, and keep the new install
 * once it is; never move the staged tree into a directory that appeared
 * meanwhile; refuse to replace an install dir that is relative, is `$HOME`,
 * or holds anything but a Camoufox install, before the download, again at
 * the swap, and on what the swap set aside; never print the token, never
 * record a version it did not install, leave no temp or staging files, and
 * install nothing when the manifest is invalid.
 *
 * <p>Each case runs the REAL script through `InstallCamoufoxHarness`, in a
 * throwaway tree with stubbed downloaders, `unzip`, `mv` and a `node`
 * wrapper, so no case touches the network and every download decision is
 * visible in the call log.
 */

import { createHash } from 'node:crypto';

import {
  type AssetCache,
  type BinaryEntry,
  CACHED_BINARIES,
  COLD,
  FOREIGN_ASSET,
  FOREIGN_TEXT,
  INSTALLED_BINARY,
  type IScenario,
  type MidRun,
  PREVIOUS_BINARY,
  removeCreatedTrees,
  runInstall,
  SAMPLE_ASSET,
  SAMPLE_TAG,
  STUB_ASSET_SHA256,
} from './InstallCamoufoxHarness.js';

const SAMPLE_VERSION_JSON = '{"version":"100.0.0","release":"beta.1"}';
/** A cache left by another release, e.g. camoufox-js's own newest one. */
const OTHER_VERSION_JSON = '{"version":"156.0.1","release":"beta.36"}';
const SAMPLE_ASSET_URL = `https://github.com/daijro/camoufox/releases/download/${SAMPLE_TAG}/${SAMPLE_ASSET}`;
const TOKEN = 'fake-token-that-must-never-print';
/** A well-formed digest that no stub download matches. */
const FOREIGN_SHA256 = createHash('sha256').update(FOREIGN_ASSET).digest('hex');
/** Tree-relative `CAMOUFOX_INSTALL_DIR` for the relocation case. */
const CUSTOM_DIR_REL = 'opt/camoufox';
/** A file the user keeps in the install dir; a refused run must not touch it. */
const FOREIGN_FILE_REL = `${CUSTOM_DIR_REL}/notes.txt`;
/** A `version.json` that some other tool wrote: not tag-shaped. */
const FOREIGN_VERSION_JSON = '{"name":"notes","version":"1.0.0"}';

/** Archive contents the script must refuse to record as installed. */
const UNUSABLE_ARCHIVES: readonly BinaryEntry[] = ['nothing', 'directory'];

/** Every asset-dir state. */
const ASSET_CACHES: readonly AssetCache[] = [
  'off',
  'miss',
  'pinned',
  'swapped',
  'directory',
  'linked',
];

/** A good run per asset-dir state: downloads, kept asset digest, step output. */
const ASSET_OUTCOMES: Readonly<Record<AssetCache, readonly [number, string, string]>> = {
  off: [1, '', ''],
  miss: [1, STUB_ASSET_SHA256, 'downloaded=true\n'],
  pinned: [0, STUB_ASSET_SHA256, 'downloaded=false\n'],
  swapped: [1, STUB_ASSET_SHA256, 'downloaded=true\n'],
  directory: [1, STUB_ASSET_SHA256, 'downloaded=true\n'],
  linked: [1, STUB_ASSET_SHA256, 'downloaded=true\n'],
};

/** A stale install of another release: what a failed run must keep. */
const PREVIOUS: IScenario = { ...COLD, cachedVersionJson: OTHER_VERSION_JSON };

/** Commands that download a release asset. */
const DOWNLOADERS: readonly string[] = ['gh', 'curl'];

/** Each download path and the token that selects it. */
const DOWNLOAD_PATHS: readonly { readonly via: string; readonly token: string }[] = [
  { via: 'curl', token: '' },
  { via: 'gh', token: TOKEN },
];

/** Runs with no kept asset; each must download the pinned asset exactly once. */
const MISSES: readonly { readonly label: string; readonly scenario: IScenario }[] = [
  { label: 'cold tokenless', scenario: COLD },
  { label: 'cold token', scenario: { ...COLD, token: TOKEN } },
  { label: 'stale-version', scenario: { ...COLD, cachedVersionJson: OTHER_VERSION_JSON } },
  {
    label: 'unusable-binary',
    scenario: { ...COLD, cachedVersionJson: SAMPLE_VERSION_JSON, cachedBinary: 'empty' },
  },
];

/** The custom install dir holding a stale Camoufox install. */
const STALE_CUSTOM: IScenario = {
  ...COLD,
  installDir: CUSTOM_DIR_REL,
  cachedVersionJson: OTHER_VERSION_JSON,
  foreign: FOREIGN_FILE_REL,
};

/**
 * Install dirs a run must refuse to replace. Each row breaks exactly one
 * rule, so it fails only if that rule is enforced.
 */
const REFUSED: readonly { readonly label: string; readonly scenario: IScenario }[] = [
  { label: 'a relative path', scenario: { ...STALE_CUSTOM, installDirAs: 'relative' } },
  {
    label: '$HOME, even one holding Camoufox',
    scenario: { ...STALE_CUSTOM, installDir: 'home', foreign: 'home/notes.txt' },
  },
  {
    label: 'a directory of other files',
    scenario: { ...COLD, installDir: CUSTOM_DIR_REL, foreign: FOREIGN_FILE_REL },
  },
  {
    label: "another tool's version.json",
    scenario: { ...STALE_CUSTOM, cachedVersionJson: FOREIGN_VERSION_JSON, cachedBinary: 'missing' },
  },
  {
    label: 'a regular file',
    scenario: { ...COLD, installDir: CUSTOM_DIR_REL, foreign: CUSTOM_DIR_REL },
  },
];

/** The custom install dir, empty: replaceable, and nothing to put back. */
const EMPTY_CUSTOM: IScenario = {
  ...COLD,
  installDir: CUSTOM_DIR_REL,
  foreign: `${CUSTOM_DIR_REL}/`,
};

/** Install dirs a run may replace: empty, or marked by either Camoufox entry. */
const REPLACEABLE: readonly { readonly label: string; readonly scenario: IScenario }[] = [
  { label: 'an empty directory', scenario: EMPTY_CUSTOM },
  { label: 'a dir marked by camoufox-bin', scenario: { ...STALE_CUSTOM, cachedVersionJson: '{}' } },
  {
    label: 'a dir marked by a tag-shaped version.json',
    scenario: { ...STALE_CUSTOM, cachedBinary: 'missing' },
  },
];

/** Install-dir states the oracle crosses with every asset-dir state. */
const INSTALL_STATES: readonly { readonly label: string; readonly scenario: IScenario }[] = [
  { label: 'no install', scenario: COLD },
  { label: 'a stale install', scenario: PREVIOUS },
  { label: 'a pinned install', scenario: { ...COLD, cachedVersionJson: SAMPLE_VERSION_JSON } },
  {
    label: 'a pinned install with a directory binary',
    scenario: { ...COLD, cachedVersionJson: SAMPLE_VERSION_JSON, cachedBinary: 'directory' },
  },
];

/** Every install-dir state under every asset-dir state. */
const ORACLE_ROWS = INSTALL_STATES.flatMap(state =>
  ASSET_CACHES.map(assetCache => ({
    label: `${state.label}, asset dir ${assetCache}`,
    scenario: { ...state.scenario, assetCache },
  })),
);

/**
 * Ways a run ends after the old install is set aside but before the staged
 * one is in place, and the status each exits with (-1: killed by a signal).
 */
const CUT_SHORT: readonly {
  readonly label: string;
  readonly midRun: MidRun;
  readonly status: number;
}[] = [
  { label: 'the staged tree cannot be moved in', midRun: 'drop-stage', status: 1 },
  { label: 'the run gets SIGTERM', midRun: 'terminate', status: -1 },
];

afterAll(() => {
  removeCreatedTrees();
});

describe('install-camoufox/install.sh', () => {
  it('[ICS-1] an install already on the pin is re-installed from the verified asset', () => {
    const run = runInstall({ ...COLD, token: TOKEN, cachedVersionJson: SAMPLE_VERSION_JSON });
    const tools = run.calls.map(call => call.split(' ')[0]);
    expect(run.status).toBe(0);
    expect(tools).toEqual(['gh', 'unzip']);
    expect(run.binaryText).toBe(INSTALLED_BINARY);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
  });

  it('[ICS-2] with a token the pinned asset downloads via gh', () => {
    const run = runInstall({ ...COLD, token: TOKEN });
    const ghCall = `gh release download ${SAMPLE_TAG} --repo daijro/camoufox --pattern ${SAMPLE_ASSET} `;
    const tools = run.calls.map(call => call.split(' ')[0]);
    expect(run.status).toBe(0);
    expect(tools).toEqual(['gh', 'unzip']);
    expect(run.calls[0]).toContain(ghCall);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
    expect(run.output).not.toContain(TOKEN);
  });

  it('[ICS-3] without a token the pinned asset comes from the public release URL', () => {
    const run = runInstall(COLD);
    const tools = run.calls.map(call => call.split(' ')[0]);
    expect(run.status).toBe(0);
    expect(tools).toEqual(['curl', 'unzip']);
    expect(run.calls[0]).toContain(SAMPLE_ASSET_URL);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
    expect([run.debris, run.tempLeft]).toEqual([0, 0]);
  });

  it('[ICS-4] an install whose version differs from the pin is replaced', () => {
    const run = runInstall(PREVIOUS);
    expect(run.status).toBe(0);
    expect(run.calls[0]).toContain(SAMPLE_ASSET_URL);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
  });

  it.each(MISSES)(
    '[ICS-5] with no kept asset ($label) the pin downloads once, never via camoufox-js',
    row => {
      const run = runInstall(row.scenario);
      const tools = run.calls.map(call => call.split(' ')[0]);
      const downloads = tools.filter(tool => DOWNLOADERS.includes(tool));
      expect(run.status).toBe(0);
      expect(tools).not.toContain('npx');
      expect(downloads).toHaveLength(1);
      expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
    },
  );

  it('[ICS-6] an invalid manifest fails closed before any install step', () => {
    const run = runInstall({ ...COLD, tag: 'latest', token: TOKEN });
    expect(run.status).toBe(2);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain('MANIFEST-INVALID /camoufox/tag');
    expect(run.versionJson).toBe('');
  });

  it.each(CACHED_BINARIES)(
    '[ICS-7] a pinned version.json with a %s binary is re-installed',
    state => {
      const run = runInstall({
        ...COLD,
        cachedVersionJson: SAMPLE_VERSION_JSON,
        cachedBinary: state,
      });
      const tools = run.calls.map(call => call.split(' ')[0]);
      expect(run.status).toBe(0);
      expect(tools).toEqual(['curl', 'unzip']);
      expect(run.binaryText).toBe(INSTALLED_BINARY);
      expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
    },
  );

  it.each(UNUSABLE_ARCHIVES)(
    '[ICS-8] an archive extracting %s as camoufox-bin fails and keeps the previous install',
    content => {
      const run = runInstall({ ...PREVIOUS, archiveBinary: content });
      expect(run.status).toBe(1);
      expect(run.output).toContain(
        `ERROR: no usable camoufox-bin after extracting ${SAMPLE_ASSET}`,
      );
      expect([run.versionJson, run.binaryText]).toEqual([OTHER_VERSION_JSON, PREVIOUS_BINARY]);
      expect([run.debris, run.tempLeft]).toEqual([0, 0]);
    },
  );

  it('[ICS-9] CAMOUFOX_INSTALL_DIR is where the pin lands, not the per-user cache', () => {
    const run = runInstall({ ...COLD, installDir: CUSTOM_DIR_REL });
    expect(run.status).toBe(0);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
    expect(run.homeCacheExists).toBe(false);
    expect(run.debris).toBe(0);
  });

  it('[ICS-10] a kept asset that hashes to the pin installs with no download', () => {
    const run = runInstall({ ...PREVIOUS, token: TOKEN, assetCache: 'pinned' });
    const tools = run.calls.map(call => call.split(' ')[0]);
    expect(run.status).toBe(0);
    expect(tools).toEqual(['unzip']);
    expect(run.output).toContain(`Using the kept ${SAMPLE_ASSET}, which hashes to the pin`);
    expect([run.versionJson, run.binaryText]).toEqual([SAMPLE_VERSION_JSON, INSTALLED_BINARY]);
    expect(run.ghOutput).toBe('downloaded=false\n');
  });

  it.each(DOWNLOAD_PATHS)(
    '[ICS-11] an asset off the pinned SHA-256 (via $via) fails before anything is kept or replaced',
    ({ via, token }) => {
      const run = runInstall({ ...PREVIOUS, sha256: FOREIGN_SHA256, assetCache: 'miss', token });
      const tools = run.calls.map(call => call.split(' ')[0]);
      const pinned = `has sha256 ${STUB_ASSET_SHA256}, but browser-stack.json pins ${FOREIGN_SHA256}`;
      expect(run.status).toBe(1);
      expect(tools).toEqual([via]);
      expect(run.output).toContain(`ERROR: ${SAMPLE_ASSET} ${pinned}`);
      expect([run.versionJson, run.binaryText]).toEqual([OTHER_VERSION_JSON, PREVIOUS_BINARY]);
      expect([run.keptSha256, run.ghOutput, run.tempLeft]).toEqual(['', '', 0]);
    },
  );

  it("[ICS-12] GitHub's sha256:-prefixed digest form fails closed as MANIFEST-INVALID", () => {
    const run = runInstall({ ...COLD, sha256: `sha256:${STUB_ASSET_SHA256}`, token: TOKEN });
    expect(run.status).toBe(2);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain('MANIFEST-INVALID /camoufox/linuxX64Sha256');
  });

  it.each(REFUSED)('[ICS-13] a run refuses to replace $label, before downloading', row => {
    const run = runInstall(row.scenario);
    expect(run.status).toBe(1);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain('ERROR: refusing to replace ');
    expect(run.foreignText).toBe(FOREIGN_TEXT);
    expect(run.versionJson).toBe(row.scenario.cachedVersionJson);
  });

  it.each(REPLACEABLE)('[ICS-14] a run replaces $label with the pin', row => {
    const run = runInstall(row.scenario);
    expect(run.status).toBe(0);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
    expect(run.foreignText).toBe('');
  });

  it('[ICS-15] a kept asset off the pin is downloaded again and overwritten', () => {
    const run = runInstall({ ...PREVIOUS, assetCache: 'swapped' });
    const tools = run.calls.map(call => call.split(' ')[0]);
    expect(run.status).toBe(0);
    expect(tools).toEqual(['curl', 'unzip']);
    expect(run.output).toContain(`Kept ${SAMPLE_ASSET} has sha256 ${FOREIGN_SHA256}`);
    expect([run.versionJson, run.binaryText]).toEqual([SAMPLE_VERSION_JSON, INSTALLED_BINARY]);
    expect([run.keptSha256, run.ghOutput]).toEqual([STUB_ASSET_SHA256, 'downloaded=true\n']);
  });

  it('[ICS-16] an unzip error part-way through keeps the previous install', () => {
    const run = runInstall({ ...PREVIOUS, unzipExit: 3 });
    expect(run.status).toBe(3);
    expect([run.versionJson, run.binaryText]).toEqual([OTHER_VERSION_JSON, PREVIOUS_BINARY]);
    expect([run.debris, run.tempLeft]).toEqual([0, 0]);
  });

  it('[ICS-17] an install dir filled while the asset downloads is refused at the swap', () => {
    const plant = { plant: FOREIGN_FILE_REL, midRun: 'plant-at-download' as const };
    const run = runInstall({ ...COLD, installDir: CUSTOM_DIR_REL, ...plant });
    const tools = run.calls.map(call => call.split(' ')[0]);
    expect(run.status).toBe(1);
    expect(tools).toEqual(['curl', 'unzip']);
    expect(run.output).toContain(`${CUSTOM_DIR_REL}: CAMOUFOX_INSTALL_DIR must be`);
    expect([run.foreignText, run.versionJson]).toEqual([FOREIGN_TEXT, '']);
    expect([run.debris, run.tempLeft]).toEqual([0, 0]);
  });

  it.each(ORACLE_ROWS)('[ICS-18] $label ends on the verified pin with no debris', row => {
    const run = runInstall(row.scenario);
    const tools = run.calls.map(call => call.split(' ')[0]);
    const downloads = tools.filter(tool => DOWNLOADERS.includes(tool));
    const [downloadCount, kept, report] = ASSET_OUTCOMES[row.scenario.assetCache];
    expect(run.status).toBe(0);
    expect([run.versionJson, run.binaryText]).toEqual([SAMPLE_VERSION_JSON, INSTALLED_BINARY]);
    expect(downloads).toHaveLength(downloadCount);
    expect([run.keptSha256, run.ghOutput]).toEqual([kept, report]);
    expect([run.debris, run.tempLeft]).toEqual([0, 0]);
  });

  it('[ICS-19] a slashed symlink install dir is swapped as the link, leaving its target', () => {
    const target = `${CUSTOM_DIR_REL}.target`;
    const linked = { slashedLinkTo: target, foreign: `${target}/notes.txt` };
    const run = runInstall({ ...STALE_CUSTOM, ...linked });
    expect(run.status).toBe(0);
    expect([run.versionJson, run.binaryText]).toEqual([SAMPLE_VERSION_JSON, INSTALLED_BINARY]);
    expect(run.foreignText).toBe(FOREIGN_TEXT);
    expect(run.debris).toBe(0);
  });

  it('[ICS-20] an install dir refilled once the old install is set aside is neither nested into nor lost', () => {
    const refill = { plant: FOREIGN_FILE_REL, midRun: 'plant-at-set-aside' as const };
    const run = runInstall({ ...PREVIOUS, installDir: CUSTOM_DIR_REL, ...refill });
    expect(run.status).toBe(1);
    expect(run.output).toContain('ERROR: cannot move the staged install into ');
    expect(run.output).toContain('WARNING: the previous install is left at ');
    expect([run.foreignText, run.versionJson, run.binaryText]).toEqual([FOREIGN_TEXT, '', '']);
    expect(run.setAside).toBe(OTHER_VERSION_JSON);
    expect([run.debris, run.tempLeft]).toEqual([1, 0]);
  });

  it.each(CUT_SHORT)(
    '[ICS-21] when $label once the old install is set aside, it is put back',
    row => {
      const run = runInstall({ ...PREVIOUS, midRun: row.midRun });
      expect(run.status).toBe(row.status);
      expect([run.versionJson, run.binaryText]).toEqual([OTHER_VERSION_JSON, PREVIOUS_BINARY]);
      expect([run.setAside, run.debris, run.tempLeft]).toEqual(['', 0, 0]);
    },
  );

  it('[ICS-22] an empty install dir filled just before it is set aside is refused and put back', () => {
    const fill = { plant: FOREIGN_FILE_REL, midRun: 'plant-before-set-aside' as const };
    const run = runInstall({ ...EMPTY_CUSTOM, ...fill });
    expect(run.status).toBe(1);
    expect(run.output).toContain(`${CUSTOM_DIR_REL}: it changed as it was set aside`);
    expect([run.foreignText, run.versionJson, run.binaryText]).toEqual([FOREIGN_TEXT, '', '']);
    expect([run.setAside, run.debris, run.tempLeft]).toEqual(['', 0, 0]);
  });

  it('[ICS-23] a run stopped once the staged install is in place keeps it, not the old one', () => {
    const run = runInstall({ ...PREVIOUS, midRun: 'terminate-at-commit' });
    expect(run.status).toBe(-1);
    expect([run.versionJson, run.binaryText]).toEqual([SAMPLE_VERSION_JSON, INSTALLED_BINARY]);
    expect(run.output).not.toContain('WARNING');
    expect([run.setAside, run.debris, run.tempLeft]).toEqual(['', 0, 0]);
  });
});
