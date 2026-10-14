/**
 * InstallCamoufoxHarness — runs the REAL
 * `.github/actions/install-camoufox/install.sh` for one scenario and reports
 * what it left behind.
 *
 * <p>Each run gets a throwaway tree that mirrors the repo layout (script +
 * validator + its own `browser-stack.json`), with `npx`, `gh`, `curl`,
 * `unzip`, `mv` and `node` replaced by stubs on `PATH`. A stub fakes only the
 * file the real command would have produced (`mv` and `node` run the real
 * one), and all but those two record their argv, so no run touches the
 * network and every download decision is visible in the call log.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE);
const REPO_ROOT = join(THIS_DIR, '../../../../');
const SCRIPT_REL = '.github/actions/install-camoufox/install.sh';
const VALIDATOR_REL = 'scripts/browser-stack/manifest.mjs';
const CACHE_REL = 'home/.cache/camoufox';

/** A well-formed tag that is deliberately NOT the pinned one. */
const SAMPLE_TAG = 'v100.0.0-beta.1';
const SAMPLE_ASSET = 'camoufox-100.0.0-beta.1-lin.x86_64.zip';
/** SHA-256 of the empty asset the `gh` and `curl` stubs download. */
const STUB_ASSET_SHA256 = createHash('sha256').update('').digest('hex');
/** Asset bytes other than the pinned ones, e.g. a swapped cache entry. */
const FOREIGN_ASSET = 'another asset';
/** The `unzip` stub writes `ELF` plus the archive's bytes to `camoufox-bin`. */
const INSTALLED_BINARY = 'ELF';
/** A seeded install's binary, so a re-install shows in its contents. */
const PREVIOUS_BINARY = 'ELF from an earlier run';
/** Tree-relative `CAMOUFOX_ASSET_DIR` and `GITHUB_OUTPUT`, as the action sets. */
const ASSET_DIR_REL = 'assets';
const GITHUB_OUTPUT_REL = 'github-output';
/** What every planted file holds. */
const FOREIGN_TEXT = 'not camoufox';

/**
 * Variables a developer shell may export that would change the script's
 * behaviour; stripped so each case sets only its own.
 */
const STRIPPED_VARS: readonly string[] = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'CAMOUFOX_INSTALL_DIR',
  'CAMOUFOX_ASSET_DIR',
  'GITHUB_OUTPUT',
];
const INHERITED_ENV = Object.entries(process.env);
const CLEAN_ENV = INHERITED_ENV.filter(([key]): boolean => !STRIPPED_VARS.includes(key));
const BASE_ENV: NodeJS.ProcessEnv = Object.fromEntries(CLEAN_ENV);

/** Stub fragment: write `FOREIGN_TEXT` to `$PLANT_FILE`, making its dir. */
const PLANT = `mkdir -p "$(dirname "$PLANT_FILE")"; printf '${FOREIGN_TEXT}' > "$PLANT_FILE"`;
/** Downloader-stub tail: plant while the asset downloads. */
const PLANT_AT_DOWNLOAD = `[ "$MID_RUN" != plant-at-download ] || { ${PLANT}; }`;

/**
 * Stub bodies. Each but `mv` and `node` appends `<name> <argv>` to `$STUB_LOG`, then
 * creates only the file the real command would have produced. The `npx` stub
 * is a tripwire: it only logs and fails, so a `camoufox-js fetch` shows in
 * the log. `gh` writes the file its `--pattern` names, so a glob pattern
 * would not produce the asset the script unzips. Both downloaders then plant
 * when `MID_RUN` is `plant-at-download`: a directory changing while the
 * download runs. `unzip` fails on a missing archive and puts at
 * `camoufox-bin` what `UNZIP_BINARY` names: a `file` holding `ELF` plus the
 * archive's bytes (so the asset that was extracted shows in the binary), a
 * `directory`, or `nothing`, then exits with `UNZIP_EXIT`. `mv` runs the real
 * one; when it moves a directory (the old install being set aside) it may
 * plant just before, and just after it may plant, remove the staging dir
 * beside it, or send the script SIGTERM, as `MID_RUN` says. `node` runs the
 * real one (`REAL_NODE`) without logging, and sends the script SIGTERM once a
 * rename of the staging dir succeeds when `MID_RUN` is `terminate-at-commit`.
 */
const STUBS: readonly (readonly [string, string])[] = [
  ['npx', 'echo "npx $*" >> "$STUB_LOG"; exit 1'],
  [
    'gh',
    'echo "gh $*" >> "$STUB_LOG"; while [ $# -gt 0 ]; do case "$1" in ' +
      `--pattern) p="$2" ;; --dir) d="$2" ;; esac; shift; done; : > "$d/$p"; ${PLANT_AT_DOWNLOAD}`,
  ],
  [
    'curl',
    'echo "curl $*" >> "$STUB_LOG"; while [ $# -gt 0 ]; do [ "$1" = -o ] && : > "$2"; shift; done; ' +
      PLANT_AT_DOWNLOAD,
  ],
  [
    'unzip',
    'echo "unzip $*" >> "$STUB_LOG"; [ -f "$2" ] || exit 9; a="$2"; ' +
      'while [ $# -gt 0 ]; do [ "$1" = -d ] && d="$2"; shift; done; ' +
      `case "$UNZIP_BINARY" in file) printf '${INSTALLED_BINARY}%s' "$(cat "$a")" > "$d/camoufox-bin" ;; ` +
      'directory) mkdir -p "$d/camoufox-bin/lib" ;; esac; exit "$UNZIP_EXIT"',
  ],
  [
    'mv',
    'h=; d=; for a; do s="$d"; d="$a"; done; [ -d "$s" ] && h="$MID_RUN"; ' +
      `[ "$h" != plant-before-set-aside ] || { ${PLANT}; }; ` +
      `command -p mv "$@" || exit; case "$h" in plant-at-set-aside) ${PLANT} ;; ` +
      'drop-stage) rm -rf "$(dirname "$s")"/.camoufox-stage.* ;; terminate) kill -TERM "$PPID" ;; esac',
  ],
  [
    'node',
    '"$REAL_NODE" "$@" || exit; case "$MID_RUN:$2:$3" in ' +
      'terminate-at-commit:*renameSync*:*/.camoufox-stage.*) kill -TERM "$PPID" ;; esac',
  ],
];

/** State of a seeded cache's `camoufox-bin`. */
type CachedBinary = 'ok' | 'empty' | 'not-executable' | 'missing' | 'directory';

/** What sits at `camoufox-bin`, in a seeded cache or an extracted archive. */
type BinaryEntry = 'file' | 'directory' | 'nothing';

/**
 * The asset dir the action restores: `off` (no `CAMOUFOX_ASSET_DIR` or
 * `GITHUB_OUTPUT`, as in the Docker build), a cache `miss` (set, but no dir),
 * or a restored dir holding, at the asset's name, the `pinned` bytes,
 * `swapped` ones, a non-empty `directory`, or a symlink `linked` to one.
 */
type AssetCache = 'off' | 'miss' | 'pinned' | 'swapped' | 'directory' | 'linked';

/**
 * What happens part-way through a run: nothing; `FOREIGN_TEXT` planted at
 * the scenario's `plant` while the asset downloads, or just before or just
 * after the old install is set aside; just after it is set aside, the
 * staging dir vanishing or the script getting SIGTERM; or SIGTERM just after
 * the staging dir is renamed into place.
 */
type MidRun =
  | 'none'
  | 'plant-at-download'
  | 'plant-before-set-aside'
  | 'plant-at-set-aside'
  | 'drop-stage'
  | 'terminate'
  | 'terminate-at-commit';

/**
 * Write a `camoufox-bin` file.
 *
 * @param file - Binary path.
 * @param content - File contents.
 * @param mode - File mode.
 * @returns The binary path.
 */
function writeBinary(file: string, content: string, mode: number): string {
  writeFileSync(file, content);
  chmodSync(file, mode);
  return file;
}

/**
 * Make a non-empty, searchable directory: `-s` and `-x` both hold for it, so
 * only a regular-file check rejects it.
 *
 * @param path - Directory path.
 * @returns The directory path.
 */
function makeNonEmptyDirectory(path: string): string {
  const inner = join(path, 'lib');
  mkdirSync(inner, { recursive: true, mode: 0o755 });
  return path;
}

/** How each state is seeded: the entry, a file's contents, a file's mode. */
const BINARY_SEEDS: Readonly<Record<CachedBinary, readonly [BinaryEntry, string, number]>> = {
  ok: ['file', PREVIOUS_BINARY, 0o755],
  empty: ['file', '', 0o755],
  'not-executable': ['file', PREVIOUS_BINARY, 0o644],
  missing: ['nothing', '', 0],
  directory: ['directory', '', 0],
};

/** Every seeded-binary state; none may skip the install. */
const CACHED_BINARIES: readonly CachedBinary[] = Object.keys(BINARY_SEEDS) as CachedBinary[];

/**
 * Keep an asset holding the given bytes.
 *
 * @param asset - Kept asset path.
 * @param bytes - Its contents.
 * @returns The kept asset path.
 */
function writeAsset(asset: string, bytes: string): string {
  writeFileSync(asset, bytes);
  return asset;
}

/**
 * Make the kept asset's name a symlink to a non-empty directory.
 *
 * @param asset - Kept asset path.
 * @returns The kept asset path.
 */
function linkAssetToDirectory(asset: string): string {
  const target = `${asset}.target`;
  makeNonEmptyDirectory(target);
  symlinkSync(target, asset);
  return asset;
}

/**
 * Keep the pinned asset: the empty bytes the stub digest is taken over.
 *
 * @param asset - Kept asset path.
 * @returns The kept asset path.
 */
function keepPinnedAsset(asset: string): string {
  return writeAsset(asset, '');
}

/**
 * Keep an asset whose bytes were swapped for a foreign build.
 *
 * @param asset - Kept asset path.
 * @returns The kept asset path.
 */
function keepSwappedAsset(asset: string): string {
  return writeAsset(asset, FOREIGN_ASSET);
}

/** What each restored state leaves at the asset's name. */
const KEPT_ASSETS: Readonly<Partial<Record<AssetCache, (asset: string) => string>>> = {
  pinned: keepPinnedAsset,
  swapped: keepSwappedAsset,
  directory: makeNonEmptyDirectory,
  linked: linkAssetToDirectory,
};

/**
 * One scenario: the manifest tag and digest, the token, the cache, what the
 * release archive holds and how `unzip` exits, any install-dir override and
 * whether it is passed absolute or relative to the run's working directory
 * (the tree root), a tree-relative `slashedLinkTo` that makes the install
 * dir a symlink to it (seeded there) passed with a trailing slash, the asset
 * dir's state, a tree-relative `foreign` entry planted before the run (a
 * file holding `FOREIGN_TEXT`, or an empty directory when it ends in `/`),
 * what happens part-way through, and the tree-relative file it plants.
 */
interface IScenario {
  readonly tag: string;
  readonly sha256: string;
  readonly token: string;
  readonly cachedVersionJson: string;
  readonly cachedBinary: CachedBinary;
  readonly archiveBinary: BinaryEntry;
  readonly unzipExit: number;
  readonly installDir: string;
  readonly installDirAs: 'absolute' | 'relative';
  readonly slashedLinkTo: string;
  readonly assetCache: AssetCache;
  readonly foreign: string;
  readonly midRun: MidRun;
  readonly plant: string;
}

/** What one run of the script did. */
interface IInstallRun {
  readonly status: number;
  readonly output: string;
  readonly calls: readonly string[];
  readonly versionJson: string;
  readonly binaryText: string;
  readonly keptSha256: string;
  readonly ghOutput: string;
  readonly tempLeft: number;
  readonly debris: number;
  readonly setAside: string;
  readonly homeCacheExists: boolean;
  readonly foreignText: string;
}

/** A cold cache, no token, no asset dir: the baseline (Docker) scenario. */
const COLD: IScenario = {
  tag: SAMPLE_TAG,
  sha256: STUB_ASSET_SHA256,
  token: '',
  cachedVersionJson: '',
  cachedBinary: 'ok',
  archiveBinary: 'file',
  unzipExit: 0,
  installDir: '',
  installDirAs: 'absolute',
  slashedLinkTo: '',
  assetCache: 'off',
  foreign: '',
  midRun: 'none',
  plant: '',
};

/** Every tree this module created, removed by `removeCreatedTrees`. */
const CREATED: string[] = [];

/**
 * Remove every tree this module created; the suite's `afterAll`.
 *
 * @returns How many trees were removed.
 */
function removeCreatedTrees(): number {
  for (const root of CREATED) rmSync(root, { recursive: true, force: true });
  const survivors = CREATED.filter(root => existsSync(root));
  const count = String(survivors.length);
  if (survivors.length > 0) throw new ScraperError(`left ${count} temp trees`);
  return CREATED.length;
}

/**
 * Copy one repo file into the same relative path inside the tree.
 *
 * @param root - Tree root.
 * @param rel - Repo-relative path.
 * @returns The copied file's path.
 */
function copyIntoTree(root: string, rel: string): string {
  const target = join(root, rel);
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  const source = join(REPO_ROOT, rel);
  copyFileSync(source, target);
  return target;
}

/**
 * Write the tree's `browser-stack.json`, valid unless the tag or digest is not.
 *
 * @param root - Tree root.
 * @param scenario - Supplies `camoufox.tag` and `camoufox.linuxX64Sha256`.
 * @returns The manifest path.
 */
function writeManifest(root: string, scenario: IScenario): string {
  const meta = { $comment: 'Install-script test manifest.', acceptedDeltas: [] };
  const camoufox = { tag: scenario.tag, linuxX64Sha256: scenario.sha256 };
  const doc = { ...meta, camoufox, playwrightCore: { testedMinor: '1.63' } };
  const file = join(root, 'browser-stack.json');
  const text = JSON.stringify(doc);
  writeFileSync(file, text);
  return file;
}

/**
 * Write one executable stub into the tree's `bin`.
 *
 * @param bin - Stub directory.
 * @param stub - Command name and bash body.
 * @returns The stub's path.
 */
function writeStub(bin: string, stub: readonly [string, string]): string {
  const [name, body] = stub;
  const file = join(bin, name);
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

/**
 * Write every stub into the tree's `bin`.
 *
 * @param root - Tree root.
 * @returns The stub directory.
 */
function writeStubs(root: string): string {
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const stub of STUBS) writeStub(bin, stub);
  return bin;
}

/**
 * The directory the script should install into for a scenario.
 *
 * @param root - Tree root.
 * @param scenario - The scenario.
 * @returns The override when set, else the per-user cache.
 */
function cacheDirOf(root: string, scenario: IScenario): string {
  const rel = scenario.installDir === '' ? CACHE_REL : scenario.installDir;
  return join(root, rel);
}

/**
 * Seed the cache as a previous run (or the CI cache restore) would leave it.
 *
 * @param cache - Cache directory.
 * @param scenario - Supplies `version.json` and the binary's state.
 * @returns The cache directory.
 */
function seedCache(cache: string, scenario: IScenario): string {
  mkdirSync(cache, { recursive: true });
  const versionFile = join(cache, 'version.json');
  writeFileSync(versionFile, scenario.cachedVersionJson);
  const [entry, content, mode] = BINARY_SEEDS[scenario.cachedBinary];
  const binary = join(cache, 'camoufox-bin');
  if (entry === 'file') writeBinary(binary, content, mode);
  if (entry === 'directory') makeNonEmptyDirectory(binary);
  return cache;
}

/**
 * Plant the scenario's foreign entry: an empty directory when the path ends
 * in `/`, else a file holding `FOREIGN_TEXT`.
 *
 * @param root - Tree root.
 * @param foreign - Tree-relative path.
 * @returns The planted path.
 */
function plantForeign(root: string, foreign: string): string {
  const target = join(root, foreign);
  const parent = foreign.endsWith('/') ? target : dirname(target);
  mkdirSync(parent, { recursive: true });
  if (!foreign.endsWith('/')) writeFileSync(target, FOREIGN_TEXT);
  return target;
}

/**
 * Seed the install the scenario starts with: in the install dir, or, with
 * `slashedLinkTo`, in that target, the install dir being a symlink to it.
 *
 * @param root - Tree root.
 * @param scenario - The scenario.
 * @returns The scenario's install directory.
 */
function seedInstall(root: string, scenario: IScenario): string {
  const cache = cacheDirOf(root, scenario);
  const isLinked = scenario.slashedLinkTo !== '';
  const seeded = isLinked ? join(root, scenario.slashedLinkTo) : cache;
  if (scenario.cachedVersionJson !== '') seedCache(seeded, scenario);
  if (!isLinked) return cache;
  const parent = dirname(cache);
  mkdirSync(parent, { recursive: true });
  symlinkSync(seeded, cache);
  return cache;
}

/**
 * Restore the asset dir as the action's cache step would leave it.
 *
 * @param root - Tree root.
 * @param assetCache - The asset dir's state.
 * @returns The asset dir.
 */
function seedAssetCache(root: string, assetCache: AssetCache): string {
  const dir = join(root, ASSET_DIR_REL);
  const keep = KEPT_ASSETS[assetCache];
  if (keep === undefined) return dir;
  mkdirSync(dir);
  const asset = join(dir, SAMPLE_ASSET);
  keep(asset);
  return dir;
}

/**
 * Create `HOME` and the private temp dir, seed the cache the scenario starts
 * with and its asset dir, and plant its foreign entry.
 *
 * @param root - Tree root.
 * @param scenario - The scenario.
 * @returns The scenario's install directory.
 */
function prepareState(root: string, scenario: IScenario): string {
  const temp = join(root, 'tmp');
  mkdirSync(temp);
  const home = join(root, 'home');
  mkdirSync(home);
  const cache = seedInstall(root, scenario);
  if (scenario.foreign !== '') plantForeign(root, scenario.foreign);
  seedAssetCache(root, scenario.assetCache);
  return cache;
}

/**
 * Build a tree for one scenario: script, validator, manifest, stubs, temp
 * dir, cache.
 *
 * @param scenario - The scenario to set up.
 * @returns The tree root.
 */
function makeTree(scenario: IScenario): string {
  const tempRoot = tmpdir();
  const prefix = join(tempRoot, 'install-camoufox-');
  const root = mkdtempSync(prefix);
  CREATED.push(root);
  copyIntoTree(root, SCRIPT_REL);
  copyIntoTree(root, VALIDATOR_REL);
  writeManifest(root, scenario);
  writeStubs(root);
  prepareState(root, scenario);
  return root;
}

/**
 * The `CAMOUFOX_INSTALL_DIR` a scenario exports, if any.
 *
 * @param root - Tree root.
 * @param scenario - The scenario.
 * @returns The override, absolute or as given, or nothing.
 */
function installDirEnv(root: string, scenario: IScenario): NodeJS.ProcessEnv {
  if (scenario.installDir === '') return {};
  const isRelative = scenario.installDirAs === 'relative';
  const value = isRelative ? scenario.installDir : cacheDirOf(root, scenario);
  const slash = scenario.slashedLinkTo === '' ? '' : '/';
  return { CAMOUFOX_INSTALL_DIR: `${value}${slash}` };
}

/**
 * The asset dir and step-output file a scenario exports, as the action
 * does; nothing when the asset dir is off.
 *
 * @param root - Tree root.
 * @param scenario - The scenario.
 * @returns `CAMOUFOX_ASSET_DIR` and `GITHUB_OUTPUT`, or nothing.
 */
function assetCacheEnv(root: string, scenario: IScenario): NodeJS.ProcessEnv {
  if (scenario.assetCache === 'off') return {};
  const assetDir = join(root, ASSET_DIR_REL);
  const ghOutput = join(root, GITHUB_OUTPUT_REL);
  return { CAMOUFOX_ASSET_DIR: assetDir, GITHUB_OUTPUT: ghOutput };
}

/**
 * The knobs the stubs read, plus the shared stub call log.
 *
 * @param root - Tree root.
 * @param scenario - The scenario.
 * @returns Stub environment variables.
 */
function stubEnv(root: string, scenario: IScenario): NodeJS.ProcessEnv {
  const stubLog = join(root, 'stub.log');
  const unzipExit = String(scenario.unzipExit);
  const plantFile = scenario.plant === '' ? '' : join(root, scenario.plant);
  const unzip = { UNZIP_BINARY: scenario.archiveBinary, UNZIP_EXIT: unzipExit };
  const midRun = { MID_RUN: scenario.midRun, PLANT_FILE: plantFile };
  return { ...unzip, ...midRun, STUB_LOG: stubLog, REAL_NODE: process.execPath };
}

/**
 * The environment the script runs with: stubs first on `PATH`, a private
 * `HOME` and `TMPDIR`, and only the scenario's token, install dir and asset
 * dir.
 *
 * @param root - Tree root.
 * @param scenario - The scenario.
 * @returns The environment.
 */
function scenarioEnv(root: string, scenario: IScenario): NodeJS.ProcessEnv {
  const bin = join(root, 'bin');
  const path = `${bin}${delimiter}${BASE_ENV.PATH ?? ''}`;
  const home = join(root, 'home');
  const temp = join(root, 'tmp');
  const token = scenario.token === '' ? {} : { GH_TOKEN: scenario.token };
  const installDir = installDirEnv(root, scenario);
  const assets = assetCacheEnv(root, scenario);
  const stubs = stubEnv(root, scenario);
  const own = { ...token, ...installDir, ...assets, ...stubs };
  return { ...BASE_ENV, ...own, HOME: home, TMPDIR: temp, PATH: path };
}

/**
 * Read a file the run may or may not have produced.
 *
 * @param file - File path.
 * @returns Its contents, or `''` when it is absent or not a regular file.
 */
function readIfPresent(file: string): string {
  const stat = statSync(file, { throwIfNoEntry: false });
  if (stat?.isFile() !== true) return '';
  return readFileSync(file, 'utf8');
}

/**
 * The text of the scenario's foreign file after the run: the one planted
 * before it, else (none, or only a directory) the one planted part-way
 * through.
 *
 * @param root - Tree root.
 * @param scenario - The scenario; an empty path or a trailing `/` is no file.
 * @returns Its contents, or `''` when there is no such file.
 */
function foreignTextOf(root: string, scenario: IScenario): string {
  const isPlantedBefore = scenario.foreign !== '' && !scenario.foreign.endsWith('/');
  const foreign = isPlantedBefore ? scenario.foreign : scenario.plant;
  if (foreign === '' || foreign.endsWith('/')) return '';
  const file = join(root, foreign);
  return readIfPresent(file);
}

/**
 * The stub calls a run logged, in order.
 *
 * @param root - Tree root.
 * @returns One `<name> <argv>` line per call.
 */
function stubCalls(root: string): readonly string[] {
  const logFile = join(root, 'stub.log');
  const log = readIfPresent(logFile);
  return log.split('\n').filter(line => line !== '');
}

/**
 * The SHA-256 of the asset kept in the asset dir after the run.
 *
 * @param root - Tree root.
 * @returns Its hex digest, `''` when nothing was kept, or `not a file`.
 */
function keptSha256Of(root: string): string {
  const file = join(root, ASSET_DIR_REL, SAMPLE_ASSET);
  const stat = statSync(file, { throwIfNoEntry: false });
  if (stat === undefined) return '';
  if (!stat.isFile()) return 'not a file';
  const bytes = readFileSync(file);
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * What a run left beside the install dir: how many `.camoufox-*` staging or
 * set-aside dirs, and the `version.json` of any previous install set aside.
 *
 * @param installDir - The scenario's install directory.
 * @returns The `.camoufox-*` count and the set-aside install's version.
 */
function besideInstall(installDir: string): Pick<IInstallRun, 'debris' | 'setAside'> {
  const parent = dirname(installDir);
  const entries = existsSync(parent) ? readdirSync(parent) : [];
  const debris = entries.filter(name => name.startsWith('.camoufox-'));
  const held = debris.filter(name => name.startsWith('.camoufox-old.'));
  const versions = held.map(name => {
    const file = join(parent, name, 'install', 'version.json');
    return readIfPresent(file);
  });
  return { debris: debris.length, setAside: versions.join('') };
}

/**
 * What a finished run left in and beside the install dir: `version.json`,
 * the binary's text, what sits beside it, and whether the default cache
 * exists.
 *
 * @param root - Tree root.
 * @param scenario - The scenario that ran.
 * @returns The install-dir artifacts.
 */
function installArtifacts(
  root: string,
  scenario: IScenario,
): Pick<IInstallRun, 'versionJson' | 'binaryText' | 'debris' | 'setAside' | 'homeCacheExists'> {
  const cache = cacheDirOf(root, scenario);
  const versionFile = join(cache, 'version.json');
  const versionJson = readIfPresent(versionFile);
  const binaryFile = join(cache, 'camoufox-bin');
  const binaryText = readIfPresent(binaryFile);
  const homeCache = join(root, CACHE_REL);
  const beside = besideInstall(cache);
  return { versionJson, binaryText, ...beside, homeCacheExists: existsSync(homeCache) };
}

/**
 * What a finished run left behind: the stub call log, the install-dir
 * artifacts, leftover temp entries, the kept asset's digest, the step
 * output, and the foreign file's text.
 *
 * @param root - Tree root.
 * @param scenario - The scenario that ran.
 * @returns Every run artifact except status and output.
 */
function runArtifacts(root: string, scenario: IScenario): Omit<IInstallRun, 'status' | 'output'> {
  const calls = stubCalls(root);
  const installed = installArtifacts(root, scenario);
  const temp = join(root, 'tmp');
  const tempLeft = readdirSync(temp).length;
  const keptSha256 = keptSha256Of(root);
  const ghOutputFile = join(root, GITHUB_OUTPUT_REL);
  const ghOutput = readIfPresent(ghOutputFile);
  const foreignText = foreignTextOf(root, scenario);
  return { calls, ...installed, tempLeft, keptSha256, ghOutput, foreignText };
}

/**
 * Run the real script for one scenario, from the tree root so a relative
 * install dir stays inside the tree.
 *
 * @param scenario - The scenario.
 * @returns Exit status (-1 when killed), combined output, and the run's
 *   artifacts.
 */
function runInstall(scenario: IScenario): IInstallRun {
  const root = makeTree(scenario);
  const env = scenarioEnv(root, scenario);
  const script = join(root, SCRIPT_REL);
  const result = spawnSync('bash', [script], { cwd: root, env, encoding: 'utf8' });
  const output = `${result.stdout}${result.stderr}`;
  const artifacts = runArtifacts(root, scenario);
  return { status: result.status ?? -1, output, ...artifacts };
}

export type { AssetCache, BinaryEntry, IInstallRun, IScenario, MidRun };
export {
  CACHED_BINARIES,
  COLD,
  FOREIGN_ASSET,
  FOREIGN_TEXT,
  INSTALLED_BINARY,
  PREVIOUS_BINARY,
  removeCreatedTrees,
  runInstall,
  SAMPLE_ASSET,
  SAMPLE_TAG,
  STUB_ASSET_SHA256,
};
