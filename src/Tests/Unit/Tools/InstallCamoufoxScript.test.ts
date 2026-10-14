/**
 * Unit test for `.github/actions/install-camoufox/install.sh`.
 *
 * <p>The script is the one Camoufox installer shared by the CI composite
 * action and the Docker CI mirror. Its contract: install exactly the tag pinned in
 * `browser-stack.json` into the directory camoufox-js launches from, from
 * asset bytes that hash to the pinned SHA-256; use a kept asset
 * (`CAMOUFOX_ASSET_DIR`) only when it hashes to the pin, else download the
 * pin exactly once and never through `camoufox-js fetch` (which resolves its
 * own newest release, not the pin); use `gh` only when a token exists (CI)
 * and the public release URL otherwise (Docker); keep a verified download
 * in place of a kept copy that failed the hash, leave anything else at that
 * name alone, and report `downloaded` for the action's cache save; install
 * only into an absolute directory that does not exist yet, refusing any
 * other before the download; extract into a staging dir and rename it into
 * place only after the binary checks out, never into a directory that
 * appeared meanwhile; never print the token, never record a version it did
 * not install, and install nothing when the manifest is invalid.
 *
 * <p>Every case is held to one oracle: the run changes, moves or removes no
 * entry that existed before it (ctime included, so a move put back shows),
 * except that the dirs it writes into gain and lose entries and a regular
 * file at the kept asset's name that failed the pin is replaced; and it adds
 * nothing outside the install dir it created, that dir's parents and its own
 * outputs, so it also leaves no temp or staging files. ICS-25 proves the
 * oracle sees such changes.
 *
 * <p>Each case runs the REAL script through `InstallCamoufoxHarness`, in a
 * throwaway tree with stubbed downloaders and `unzip`, so no case touches
 * the network and every download decision is visible in the call log.
 */

import { createHash } from 'node:crypto';
import { chmodSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type AssetCache,
  type BinaryEntry,
  COLD,
  FOREIGN_ASSET,
  FOREIGN_TEXT,
  type IInstallRun,
  INSTALLED_BINARY,
  type IScenario,
  KEPT_REL,
  removeCreatedTrees,
  runInstall,
  SAMPLE_ASSET,
  SAMPLE_TAG,
  STUB_ASSET_SHA256,
  touchedBy,
} from './InstallCamoufoxHarness.js';

const SAMPLE_VERSION_JSON = '{"version":"100.0.0","release":"beta.1"}';
/** A cache left by another release, e.g. camoufox-js's own newest one. */
const OTHER_VERSION_JSON = '{"version":"156.0.1","release":"beta.36"}';
const SAMPLE_ASSET_URL = `https://github.com/daijro/camoufox/releases/download/${SAMPLE_TAG}/${SAMPLE_ASSET}`;
const TOKEN = 'fake-token-that-must-never-print';
/** A well-formed digest that no stub download matches. */
const FOREIGN_SHA256 = createHash('sha256').update(FOREIGN_ASSET).digest('hex');
/** Tree-relative `CAMOUFOX_INSTALL_DIR` for the relocation cases. */
const CUSTOM_DIR_REL = 'opt/camoufox';
/** A file the user keeps in the install dir. */
const FOREIGN_FILE_REL = `${CUSTOM_DIR_REL}/notes.txt`;
/** Where a symlinked install dir points. */
const LINK_TARGET_REL = `${CUSTOM_DIR_REL}.target`;
/** The refusal for an install dir that exists, naming the remedy. */
const EXISTS = 'it already exists; set CAMOUFOX_INSTALL_DIR to a path that does not';
/** The refusal for a relative install dir. */
const NOT_ABSOLUTE = 'CAMOUFOX_INSTALL_DIR must be an absolute path';

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
  directory: [1, 'not a file', 'downloaded=false\n'],
  linked: [1, 'not a file', 'downloaded=false\n'],
};

/** Asset-dir states with something other than a regular file at the asset's name. */
const IN_THE_WAY: readonly AssetCache[] = ['directory', 'linked'];

/** The custom install dir, absent. */
const CUSTOM: IScenario = { ...COLD, installDir: CUSTOM_DIR_REL };

/** The custom install dir holding a Camoufox install of another release. */
const STALE_CUSTOM: IScenario = { ...CUSTOM, cachedVersionJson: OTHER_VERSION_JSON };

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
  { label: 'custom dir', scenario: CUSTOM },
];

/**
 * Install dirs a run must refuse, and why. Each row breaks exactly one
 * rule: the relative path is absent, every other path is absolute and
 * exists. The two symlinks and the newline-named file pin review findings
 * against the replace-in-place installer this one superseded.
 */
const REFUSED: readonly {
  readonly label: string;
  readonly scenario: IScenario;
  readonly reason: string;
}[] = [
  {
    label: 'a relative path',
    scenario: { ...CUSTOM, installDirAs: 'relative' },
    reason: NOT_ABSOLUTE,
  },
  {
    label: 'an install already on the pin',
    scenario: { ...COLD, cachedVersionJson: SAMPLE_VERSION_JSON },
    reason: EXISTS,
  },
  {
    label: 'an install of another release',
    scenario: { ...COLD, cachedVersionJson: OTHER_VERSION_JSON },
    reason: EXISTS,
  },
  {
    label: 'a directory of other files',
    scenario: { ...CUSTOM, foreign: FOREIGN_FILE_REL },
    reason: EXISTS,
  },
  {
    label: 'an empty directory',
    scenario: { ...CUSTOM, foreign: `${CUSTOM_DIR_REL}/` },
    reason: EXISTS,
  },
  {
    label: 'a directory holding only a file named by a newline',
    scenario: { ...CUSTOM, foreign: `${CUSTOM_DIR_REL}/\n` },
    reason: EXISTS,
  },
  { label: 'a regular file', scenario: { ...CUSTOM, foreign: CUSTOM_DIR_REL }, reason: EXISTS },
  {
    label: 'an absolute symlink to an install',
    scenario: { ...STALE_CUSTOM, linkTo: LINK_TARGET_REL },
    reason: EXISTS,
  },
  {
    label: 'a relative symlink to an install',
    scenario: { ...STALE_CUSTOM, linkTo: LINK_TARGET_REL, linkAs: 'relative' },
    reason: EXISTS,
  },
  { label: 'a dangling symlink', scenario: { ...CUSTOM, linkTo: LINK_TARGET_REL }, reason: EXISTS },
  {
    label: '$HOME',
    scenario: { ...COLD, installDir: 'home', foreign: 'home/notes.txt' },
    reason: EXISTS,
  },
];

/** Absent install dirs the oracle crosses with every asset-dir state. */
const INSTALL_STATES: readonly { readonly label: string; readonly scenario: IScenario }[] = [
  { label: 'the per-user cache', scenario: COLD },
  { label: 'a custom dir', scenario: CUSTOM },
];

/** Every absent install dir under every asset-dir state. */
const ORACLE_ROWS = INSTALL_STATES.flatMap(state =>
  ASSET_CACHES.map(assetCache => ({
    label: `${state.label}, asset dir ${assetCache}`,
    scenario: { ...state.scenario, assetCache },
  })),
);

/**
 * Move the seeded install aside and put it back, as a swap that rolled back
 * would.
 *
 * @param root - Tree root.
 * @returns The install dir.
 */
function setAsideInstall(root: string): string {
  const install = join(root, CUSTOM_DIR_REL);
  const aside = `${install}.previous`;
  renameSync(install, aside);
  renameSync(aside, install);
  return install;
}

/**
 * Make the kept asset executable.
 *
 * @param root - Tree root.
 * @returns The kept asset.
 */
function chmodKeptAsset(root: string): string {
  const kept = join(root, KEPT_REL);
  chmodSync(kept, 0o755);
  return kept;
}

/**
 * Replace the kept asset with the stub download's bytes in one rename, as
 * keeping a download does.
 *
 * @param root - Tree root.
 * @returns The kept asset.
 */
function replaceKeptAsset(root: string): string {
  const kept = join(root, KEPT_REL);
  const fresh = `${kept}.fresh`;
  writeFileSync(fresh, '');
  renameSync(fresh, kept);
  return kept;
}

/** Changes the oracle must report, and the one rewrite it must allow. */
const ORACLE_PROBES: readonly {
  readonly label: string;
  readonly scenario: IScenario;
  readonly act: (root: string) => string;
  readonly touched: readonly string[];
}[] = [
  {
    label: 'reports an install set aside and put back',
    scenario: STALE_CUSTOM,
    act: setAsideInstall,
    touched: [`changed ${CUSTOM_DIR_REL}`],
  },
  {
    label: 'reports a mode change on a kept asset that hashes to the pin',
    scenario: { ...COLD, assetCache: 'pinned' },
    act: chmodKeptAsset,
    touched: [`changed ${KEPT_REL}`],
  },
  {
    label: 'reports a kept asset on the pin replaced by the same bytes',
    scenario: { ...COLD, assetCache: 'pinned' },
    act: replaceKeptAsset,
    touched: [`changed ${KEPT_REL}`],
  },
  {
    label: 'allows a kept asset off the pin to be replaced',
    scenario: { ...COLD, assetCache: 'swapped' },
    act: replaceKeptAsset,
    touched: [],
  },
];

/**
 * Run the real script for a scenario and hold it to the oracle in the
 * header: `touched` lists every entry the run had no business changing,
 * removing or adding.
 *
 * @param scenario - The scenario.
 * @returns What the run did.
 */
function install(scenario: IScenario): IInstallRun {
  const run = runInstall(scenario);
  expect(run.touched).toEqual([]);
  return run;
}

afterAll(() => {
  removeCreatedTrees();
});

describe('install-camoufox/install.sh', () => {
  it('[ICS-2] with a token the pinned asset downloads via gh', () => {
    const run = install({ ...COLD, token: TOKEN });
    const ghCall = `gh release download ${SAMPLE_TAG} --repo daijro/camoufox --pattern ${SAMPLE_ASSET} `;
    const tools = run.calls.map(call => call.split(' ')[0]);
    expect(run.status).toBe(0);
    expect(tools).toEqual(['gh', 'unzip']);
    expect(run.calls[0]).toContain(ghCall);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
    expect(run.output).not.toContain(TOKEN);
  });

  it('[ICS-3] without a token the pinned asset comes from the public release URL', () => {
    const run = install(COLD);
    const tools = run.calls.map(call => call.split(' ')[0]);
    expect(run.status).toBe(0);
    expect(tools).toEqual(['curl', 'unzip']);
    expect(run.calls[0]).toContain(SAMPLE_ASSET_URL);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
  });

  it.each(MISSES)(
    '[ICS-5] with no kept asset ($label) the pin downloads once, never via camoufox-js',
    row => {
      const run = install(row.scenario);
      const tools = run.calls.map(call => call.split(' ')[0]);
      const downloads = tools.filter(tool => DOWNLOADERS.includes(tool));
      expect(run.status).toBe(0);
      expect(tools).not.toContain('npx');
      expect(downloads).toHaveLength(1);
      expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
    },
  );

  it('[ICS-6] an invalid manifest fails closed before any install step', () => {
    const run = install({ ...COLD, tag: 'latest', token: TOKEN });
    expect(run.status).toBe(2);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain('MANIFEST-INVALID /camoufox/tag');
    expect(run.installDirExists).toBe(false);
  });

  it.each(UNUSABLE_ARCHIVES)(
    '[ICS-8] an archive extracting %s as camoufox-bin fails and installs nothing',
    content => {
      const run = install({ ...COLD, archiveBinary: content });
      expect(run.status).toBe(1);
      expect(run.output).toContain(
        `ERROR: no usable camoufox-bin after extracting ${SAMPLE_ASSET}`,
      );
      expect(run.installDirExists).toBe(false);
    },
  );

  it('[ICS-9] CAMOUFOX_INSTALL_DIR is where the pin lands, not the per-user cache', () => {
    const run = install(CUSTOM);
    expect(run.status).toBe(0);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
    expect(run.homeCacheExists).toBe(false);
  });

  it('[ICS-10] a kept asset that hashes to the pin installs with no download', () => {
    const run = install({ ...COLD, token: TOKEN, assetCache: 'pinned' });
    const tools = run.calls.map(call => call.split(' ')[0]);
    expect(run.status).toBe(0);
    expect(tools).toEqual(['unzip']);
    expect(run.output).toContain(`Using the kept ${SAMPLE_ASSET}, which hashes to the pin`);
    expect([run.versionJson, run.binaryText]).toEqual([SAMPLE_VERSION_JSON, INSTALLED_BINARY]);
    expect(run.ghOutput).toBe('downloaded=false\n');
  });

  it.each(DOWNLOAD_PATHS)(
    '[ICS-11] an asset off the pinned SHA-256 (via $via) fails before anything is kept or installed',
    ({ via, token }) => {
      const run = install({ ...COLD, sha256: FOREIGN_SHA256, assetCache: 'miss', token });
      const tools = run.calls.map(call => call.split(' ')[0]);
      const pinned = `has sha256 ${STUB_ASSET_SHA256}, but browser-stack.json pins ${FOREIGN_SHA256}`;
      expect(run.status).toBe(1);
      expect(tools).toEqual([via]);
      expect(run.output).toContain(`ERROR: ${SAMPLE_ASSET} ${pinned}`);
      expect(run.installDirExists).toBe(false);
      expect([run.keptSha256, run.ghOutput]).toEqual(['', '']);
    },
  );

  it("[ICS-12] GitHub's sha256:-prefixed digest form fails closed as MANIFEST-INVALID", () => {
    const run = install({ ...COLD, sha256: `sha256:${STUB_ASSET_SHA256}`, token: TOKEN });
    expect(run.status).toBe(2);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain('MANIFEST-INVALID /camoufox/linuxX64Sha256');
  });

  it.each(REFUSED)('[ICS-13] a run refuses to install into $label, before downloading', row => {
    const run = install(row.scenario);
    expect(run.status).toBe(1);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain('ERROR: refusing to install into ');
    expect(run.output).toContain(row.reason);
  });

  it('[ICS-15] a kept asset off the pin is downloaded again and overwritten', () => {
    const run = install({ ...COLD, assetCache: 'swapped' });
    const tools = run.calls.map(call => call.split(' ')[0]);
    expect(run.status).toBe(0);
    expect(tools).toEqual(['curl', 'unzip']);
    expect(run.output).toContain(`Kept ${SAMPLE_ASSET} has sha256 ${FOREIGN_SHA256}`);
    expect([run.versionJson, run.binaryText]).toEqual([SAMPLE_VERSION_JSON, INSTALLED_BINARY]);
    expect([run.keptSha256, run.ghOutput]).toEqual([STUB_ASSET_SHA256, 'downloaded=true\n']);
  });

  it('[ICS-16] an unzip error part-way through installs nothing', () => {
    const run = install({ ...COLD, unzipExit: 3 });
    expect(run.status).toBe(3);
    expect(run.installDirExists).toBe(false);
  });

  it('[ICS-17] an install dir filled while the asset downloads is left as it is', () => {
    const plant = { plant: FOREIGN_FILE_REL, midRun: 'plant-at-download' as const };
    const run = install({ ...CUSTOM, ...plant });
    const tools = run.calls.map(call => call.split(' ')[0]);
    expect(run.status).toBe(1);
    expect(tools).toEqual(['curl', 'unzip']);
    expect(run.output).toContain('ERROR: cannot rename the staged install to ');
    expect([run.plantedText, run.versionJson]).toEqual([FOREIGN_TEXT, '']);
  });

  it.each(ORACLE_ROWS)('[ICS-18] $label ends on the verified pin', row => {
    const run = install(row.scenario);
    const tools = run.calls.map(call => call.split(' ')[0]);
    const downloads = tools.filter(tool => DOWNLOADERS.includes(tool));
    const [downloadCount, kept, report] = ASSET_OUTCOMES[row.scenario.assetCache];
    expect(run.status).toBe(0);
    expect([run.versionJson, run.binaryText]).toEqual([SAMPLE_VERSION_JSON, INSTALLED_BINARY]);
    expect(downloads).toHaveLength(downloadCount);
    expect([run.keptSha256, run.ghOutput]).toEqual([kept, report]);
  });

  it.each(IN_THE_WAY)(
    "[ICS-24] a %s at the kept asset's name is left alone and the download is not kept",
    assetCache => {
      const run = install({ ...COLD, assetCache });
      expect(run.status).toBe(0);
      expect(run.output).toContain(`WARNING: not keeping ${SAMPLE_ASSET}: `);
      expect([run.versionJson, run.ghOutput]).toEqual([SAMPLE_VERSION_JSON, 'downloaded=false\n']);
    },
  );

  it.each(ORACLE_PROBES)('[ICS-25] the oracle $label', row => {
    const touched = touchedBy(row.scenario, row.act);
    expect(touched).toEqual(row.touched);
  });
});
