/**
 * InstallCamoufoxHarness — runs the REAL
 * `.github/actions/install-camoufox/install.sh` for one scenario and reports
 * what it left behind.
 *
 * <p>Each run gets a throwaway tree that mirrors the repo layout (script +
 * validator + its own `browser-stack.json`), with `npx`, `gh`, `curl` and
 * `unzip` replaced by stubs on `PATH`. A stub records its argv and fakes only
 * the file the real command would have produced, so no run touches the
 * network and every download decision is visible in the call log. The tree
 * is snapshotted before and after the run, ctime included, so a case can see
 * every entry the run changed, removed or added, even one it moved away and
 * put back.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  type BigIntStats,
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE);
const REPO_ROOT = join(THIS_DIR, '../../../../');
const SCRIPT_REL = '.github/actions/install-camoufox/install.sh';
const VALIDATOR_REL = 'scripts/browser-stack/manifest.mjs';
const CACHE_REL = 'home/.cache/camoufox';
/** Tree-relative `TMPDIR`. */
const TEMP_REL = 'tmp';

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
/** Tree-relative kept asset and stub call log. */
const KEPT_REL = join(ASSET_DIR_REL, SAMPLE_ASSET);
const STUB_LOG_REL = 'stub.log';
/** Entries a run may add besides the install dir and its parents. */
const OWN_OUTPUTS: readonly string[] = [ASSET_DIR_REL, KEPT_REL, GITHUB_OUTPUT_REL, STUB_LOG_REL];
/** A signature's ctime suffix, ` @<ns>`. */
const CTIME_SUFFIX = / @\d+$/;
/** Long enough for the clock to pass the coarse tick a seeded ctime fell in. */
const SETTLE_MS = 50;
const SETTLE_BUFFER = new SharedArrayBuffer(4);
const SETTLE_CELL = new Int32Array(SETTLE_BUFFER);
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
 * Stub bodies. Each appends `<name> <argv>` to `$STUB_LOG`, then creates
 * only the file the real command would have produced. The `npx` stub is a
 * tripwire: it only logs and fails, so a `camoufox-js fetch` shows in the
 * log. `gh` writes the file its `--pattern` names, so a glob pattern would
 * not produce the asset the script unzips. Both downloaders then plant when
 * `MID_RUN` is `plant-at-download`: a directory changing while the download
 * runs. `unzip` fails on a missing archive and puts at `camoufox-bin` what
 * `UNZIP_BINARY` names: a `file` holding `ELF` plus the archive's bytes (so
 * the asset that was extracted shows in the binary), a `directory`, or
 * `nothing`, then exits with `UNZIP_EXIT`.
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
];

/** What sits at `camoufox-bin` in an extracted archive. */
type BinaryEntry = 'file' | 'directory' | 'nothing';

/**
 * The asset dir the action restores: `off` (no `CAMOUFOX_ASSET_DIR` or
 * `GITHUB_OUTPUT`, as in the Docker build), a cache `miss` (set, but no dir),
 * or a restored dir holding, at the asset's name, the `pinned` bytes,
 * `swapped` ones, a non-empty `directory`, or a symlink `linked` to one.
 */
type AssetCache = 'off' | 'miss' | 'pinned' | 'swapped' | 'directory' | 'linked';

/**
 * What happens part-way through a run: nothing, or `FOREIGN_TEXT` planted at
 * the scenario's `plant` while the asset downloads.
 */
type MidRun = 'none' | 'plant-at-download';

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
 * One scenario: the manifest tag and digest, the token, a previous install
 * (its `version.json`, beside a `camoufox-bin`; none when empty), what the
 * release archive holds and how `unzip` exits, any install-dir override and
 * whether it is passed absolute or relative to the run's working directory
 * (the tree root), a tree-relative `linkTo` that makes the install dir an
 * absolute or relative symlink to it (any previous install is seeded there;
 * with none the link dangles) passed with a trailing slash, the asset dir's
 * state, a tree-relative `foreign` entry planted before the run (a file
 * holding `FOREIGN_TEXT`, or an empty directory when it ends in `/`), what
 * happens part-way through, and the tree-relative file it plants.
 */
interface IScenario {
  readonly tag: string;
  readonly sha256: string;
  readonly token: string;
  readonly cachedVersionJson: string;
  readonly archiveBinary: BinaryEntry;
  readonly unzipExit: number;
  readonly installDir: string;
  readonly installDirAs: 'absolute' | 'relative';
  readonly linkTo: string;
  readonly linkAs: 'absolute' | 'relative';
  readonly assetCache: AssetCache;
  readonly foreign: string;
  readonly midRun: MidRun;
  readonly plant: string;
}

/**
 * What one run of the script did. `touched` lists, as `changed <path>` or
 * `added <path>`, every entry the run had no business changing: any entry
 * that existed before the run and is gone or differs after it, in type,
 * mode, bytes or ctime (so a move put back shows too), except a dir the run
 * writes into changing only its ctime and a regular file at the kept
 * asset's name that failed the pin being replaced by a file; and any new
 * entry outside the install dir it created, that dir's parents and its own
 * outputs.
 */
interface IInstallRun {
  readonly status: number;
  readonly output: string;
  readonly calls: readonly string[];
  readonly versionJson: string;
  readonly binaryText: string;
  readonly keptSha256: string;
  readonly ghOutput: string;
  readonly installDirExists: boolean;
  readonly homeCacheExists: boolean;
  readonly plantedText: string;
  readonly touched: readonly string[];
}

/** A cold cache, no token, no asset dir: the baseline (Docker) scenario. */
const COLD: IScenario = {
  tag: SAMPLE_TAG,
  sha256: STUB_ASSET_SHA256,
  token: '',
  cachedVersionJson: '',
  archiveBinary: 'file',
  unzipExit: 0,
  installDir: '',
  installDirAs: 'absolute',
  linkTo: '',
  linkAs: 'absolute',
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
  const protocolSha256 = '0'.repeat(64);
  const camoufox = { tag: scenario.tag, linuxX64Sha256: scenario.sha256, protocolSha256 };
  const playwrightCore = { testedMinor: '1.63', protocolSha256: {} };
  const doc = { ...meta, camoufox, playwrightCore };
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
 * Seed a previous install: the scenario's `version.json` and a binary.
 *
 * @param cache - Install directory.
 * @param scenario - Supplies `version.json`.
 * @returns The install directory.
 */
function seedCache(cache: string, scenario: IScenario): string {
  mkdirSync(cache, { recursive: true });
  const versionFile = join(cache, 'version.json');
  writeFileSync(versionFile, scenario.cachedVersionJson);
  const binary = join(cache, 'camoufox-bin');
  writeBinary(binary, PREVIOUS_BINARY, 0o755);
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
 * Make the install dir a symlink to the seeded target.
 *
 * @param link - The install dir.
 * @param target - The link's target.
 * @param linkAs - Whether the link holds an absolute or a relative path.
 * @returns The install dir.
 */
function linkInstallDir(link: string, target: string, linkAs: IScenario['linkAs']): string {
  const parent = dirname(link);
  mkdirSync(parent, { recursive: true });
  const value = linkAs === 'relative' ? relative(parent, target) : target;
  symlinkSync(value, link);
  return link;
}

/**
 * Seed the install the scenario starts with: in the install dir, or, with
 * `linkTo`, in that target, the install dir being a symlink to it.
 *
 * @param root - Tree root.
 * @param scenario - The scenario.
 * @returns The scenario's install directory.
 */
function seedInstall(root: string, scenario: IScenario): string {
  const cache = cacheDirOf(root, scenario);
  const isLinked = scenario.linkTo !== '';
  const seeded = isLinked ? join(root, scenario.linkTo) : cache;
  if (scenario.cachedVersionJson !== '') seedCache(seeded, scenario);
  if (isLinked) linkInstallDir(cache, seeded, scenario.linkAs);
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
  const temp = join(root, TEMP_REL);
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
  const slash = scenario.linkTo === '' ? '' : '/';
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
  const stubLog = join(root, STUB_LOG_REL);
  const unzipExit = String(scenario.unzipExit);
  const plantFile = scenario.plant === '' ? '' : join(root, scenario.plant);
  const unzip = { UNZIP_BINARY: scenario.archiveBinary, UNZIP_EXIT: unzipExit };
  const midRun = { MID_RUN: scenario.midRun, PLANT_FILE: plantFile };
  return { ...unzip, ...midRun, STUB_LOG: stubLog };
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
  const temp = join(root, TEMP_REL);
  const token = scenario.token === '' ? {} : { GH_TOKEN: scenario.token };
  const installDir = installDirEnv(root, scenario);
  const assets = assetCacheEnv(root, scenario);
  const stubs = stubEnv(root, scenario);
  const own = { ...token, ...installDir, ...assets, ...stubs };
  return { ...BASE_ENV, ...own, HOME: home, TMPDIR: temp, PATH: path };
}

/**
 * Whether an fs error means nothing is at the path.
 *
 * @param error - The thrown value.
 * @returns True for `ENOENT` and `ENOTDIR`.
 */
function isNoEntry(error: unknown): boolean {
  const { code } = error as NodeJS.ErrnoException;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Open a path for reading.
 *
 * @param file - File path.
 * @returns The descriptor, or `absent` when nothing is there.
 */
function openIfPresent(file: string): number | 'absent' {
  try {
    return openSync(file, 'r');
  } catch (error) {
    if (isNoEntry(error)) return 'absent';
    throw error;
  }
}

/**
 * Read a path through one descriptor, so the regular-file check and the
 * read see the same file even if the path is replaced in between.
 *
 * @param file - File path.
 * @returns Its bytes, `absent`, or `not a file`.
 */
function readRegularFile(file: string): Buffer | 'absent' | 'not a file' {
  const fd = openIfPresent(file);
  if (fd === 'absent') return fd;
  try {
    const stat = fstatSync(fd);
    return stat.isFile() ? readFileSync(fd) : 'not a file';
  } finally {
    closeSync(fd);
  }
}

/**
 * Read a file the run may or may not have produced.
 *
 * @param file - File path.
 * @returns Its contents, or `''` when it is absent or not a regular file.
 */
function readIfPresent(file: string): string {
  const read = readRegularFile(file);
  return typeof read === 'string' ? '' : read.toString('utf8');
}

/**
 * The text of the file planted part-way through the run, after it.
 *
 * @param root - Tree root.
 * @param scenario - The scenario; an empty `plant` is no file.
 * @returns Its contents, or `''` when there is no such file.
 */
function plantedTextOf(root: string, scenario: IScenario): string {
  if (scenario.plant === '') return '';
  const file = join(root, scenario.plant);
  return readIfPresent(file);
}

/**
 * The stub calls a run logged, in order.
 *
 * @param root - Tree root.
 * @returns One `<name> <argv>` line per call.
 */
function stubCalls(root: string): readonly string[] {
  const logFile = join(root, STUB_LOG_REL);
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
  const file = join(root, KEPT_REL);
  const read = readRegularFile(file);
  if (read === 'absent') return '';
  if (read === 'not a file') return read;
  return createHash('sha256').update(read).digest('hex');
}

/**
 * Open an entry itself, never a symlink's target.
 *
 * @param path - Entry path.
 * @returns The descriptor, or `symlink` when the entry is one.
 */
function openNoFollow(path: string): number | 'symlink' {
  try {
    return openSync(path, constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') return 'symlink';
    throw error;
  }
}

/**
 * An entry's ctime as a signature suffix: a rename, mode change or write
 * moves it, even one undone before the snapshot.
 *
 * @param stat - The entry's stat, with nanosecond times.
 * @returns ` @<ns>`.
 */
function ctimeOf(stat: BigIntStats): string {
  return ` @${String(stat.ctimeNs)}`;
}

/**
 * Describe what a descriptor holds: a directory and its mode, or a file,
 * its mode and the SHA-256 of its bytes; each with its ctime.
 *
 * @param fd - Open descriptor.
 * @returns The description.
 */
function describeOpen(fd: number): string {
  const stat = fstatSync(fd, { bigint: true });
  const mode = (stat.mode % 0o10000n).toString(8);
  const ctime = ctimeOf(stat);
  if (stat.isDirectory()) return `dir ${mode}${ctime}`;
  if (!stat.isFile()) return `other ${mode}${ctime}`;
  const bytes = readFileSync(fd);
  const digest = createHash('sha256').update(bytes).digest('hex');
  return `file ${mode} ${digest}${ctime}`;
}

/**
 * Describe one entry: a symlink by its target and ctime, anything else
 * through one descriptor, so the type check and the read see the same entry.
 *
 * @param path - Entry path.
 * @returns The description.
 */
function signatureOf(path: string): string {
  const fd = openNoFollow(path);
  if (fd === 'symlink') {
    const stat = lstatSync(path, { bigint: true });
    return `link ${readlinkSync(path)}${ctimeOf(stat)}`;
  }
  try {
    return describeOpen(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Describe every entry under a tree-relative path, recursing into
 * directories but not through symlinks.
 *
 * @param root - Tree root.
 * @param rel - Tree-relative path (`''` for the root).
 * @param out - Collects path to description.
 * @returns The collected descriptions.
 */
function snapshotInto(root: string, rel: string, out: Map<string, string>): Map<string, string> {
  const path = join(root, rel);
  const signature = signatureOf(path);
  out.set(rel, signature);
  if (!signature.startsWith('dir ')) return out;
  const children = readdirSync(path).map(name => join(rel, name));
  for (const child of children) snapshotInto(root, child, out);
  return out;
}

/**
 * Describe every entry in a tree.
 *
 * @param root - Tree root.
 * @returns Tree-relative path to description.
 */
function snapshotTree(root: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  return snapshotInto(root, '', out);
}

/** What a run is held to: the tree after it, the dirs it writes into, the pin. */
interface IOracle {
  readonly after: ReadonlyMap<string, string>;
  readonly writtenDirs: ReadonlySet<string>;
  readonly pinnedSha256: string;
}

/**
 * A signature without its ctime.
 *
 * @param signature - Entry description.
 * @returns The description minus ` @<ns>`.
 */
function withoutCtime(signature: string): string {
  return signature.replace(CTIME_SUFFIX, '');
}

/**
 * The tree-relative install dir a scenario targets.
 *
 * @param scenario - The scenario.
 * @returns Its install dir, or the per-user cache.
 */
function installRelOf(scenario: IScenario): string {
  return scenario.installDir === '' ? CACHE_REL : scenario.installDir;
}

/**
 * Dirs a run adds entries to or removes them from, so their ctime alone may
 * change: the tree root, `TMPDIR`, the asset dir and the install dir's parents.
 *
 * @param scenario - The scenario.
 * @returns Their tree-relative paths.
 */
function writtenDirsOf(scenario: IScenario): ReadonlySet<string> {
  const installRel = installRelOf(scenario);
  const parts = installRel.split('/');
  const depths = parts.slice(1).map((_, index) => index + 1);
  const parents = depths.map(depth => parts.slice(0, depth).join('/'));
  return new Set(['', TEMP_REL, ASSET_DIR_REL, ...parents]);
}

/**
 * Whether a change is the one rewrite the contract allows: a regular file at
 * the kept asset's name that failed the pin, replaced by a regular file.
 *
 * @param entry - Tree-relative path and its description before the run.
 * @param now - Its description after the run.
 * @param pinnedSha256 - The digest the manifest pins.
 * @returns True for that rewrite.
 */
function isFailedAssetReplaced(
  entry: readonly [string, string],
  now: string,
  pinnedSha256: string,
): boolean {
  const [rel, before] = entry;
  const [kind, , digest] = before.split(' ');
  const isFailedFile = kind === 'file' && digest !== pinnedSha256;
  return rel === KEPT_REL && isFailedFile && now.startsWith('file ');
}

/**
 * Whether a run broke a pre-existing entry: changed, moved or removed it.
 *
 * @param entry - Tree-relative path and its description before the run.
 * @param oracle - What the run is held to.
 * @returns True when the entry may not differ but does.
 */
function isBroken(entry: readonly [string, string], oracle: IOracle): boolean {
  const [rel, before] = entry;
  const now = oracle.after.get(rel) ?? 'absent';
  if (now === before) return false;
  const isWrittenDir = oracle.writtenDirs.has(rel) && before.startsWith('dir ');
  if (isWrittenDir && withoutCtime(now) === withoutCtime(before)) return false;
  return !isFailedAssetReplaced(entry, now, oracle.pinnedSha256);
}

/**
 * Whether a run may add an entry: the install dir it created and anything
 * in it, a parent it made for that dir, or one of its own outputs.
 *
 * @param rel - Tree-relative path of the new entry.
 * @param installRel - Tree-relative install dir.
 * @param before - The tree before the run.
 * @returns True when the run may add it.
 */
function isOwnAddition(
  rel: string,
  installRel: string,
  before: ReadonlyMap<string, string>,
): boolean {
  const isParent = installRel.startsWith(`${rel}/`);
  const isInside = rel === installRel || rel.startsWith(`${installRel}/`);
  const isCreated = isInside && !before.has(installRel);
  return isParent || isCreated || OWN_OUTPUTS.includes(rel);
}

/**
 * Every entry a run had no business changing, removing or adding.
 *
 * @param scenario - The scenario that ran.
 * @param before - The tree before the run.
 * @param after - The tree after it.
 * @returns `changed <path>` and `added <path>` lines.
 */
function touchedEntries(
  scenario: IScenario,
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): readonly string[] {
  const installRel = installRelOf(scenario);
  const writtenDirs = writtenDirsOf(scenario);
  const oracle: IOracle = { after, writtenDirs, pinnedSha256: scenario.sha256 };
  const broken = [...before].filter(entry => isBroken(entry, oracle));
  const fresh = [...after.keys()].filter(rel => !before.has(rel));
  const stray = fresh.filter(rel => !isOwnAddition(rel, installRel, before));
  const changed = broken.map(([rel]) => `changed ${rel}`);
  return [...changed, ...stray.map(rel => `added ${rel}`)];
}

/**
 * What a finished run left in the install dir: `version.json`, the binary's
 * text, whether anything is there, and whether the default cache exists.
 *
 * @param root - Tree root.
 * @param scenario - The scenario that ran.
 * @returns The install-dir artifacts.
 */
function installArtifacts(
  root: string,
  scenario: IScenario,
): Pick<IInstallRun, 'versionJson' | 'binaryText' | 'installDirExists' | 'homeCacheExists'> {
  const cache = cacheDirOf(root, scenario);
  const versionFile = join(cache, 'version.json');
  const versionJson = readIfPresent(versionFile);
  const binaryFile = join(cache, 'camoufox-bin');
  const binaryText = readIfPresent(binaryFile);
  const homeCache = join(root, CACHE_REL);
  const exists = { installDirExists: existsSync(cache), homeCacheExists: existsSync(homeCache) };
  return { versionJson, binaryText, ...exists };
}

/**
 * What a finished run left behind: the stub call log, the install-dir
 * artifacts, the kept asset's digest, the step output, the planted file's
 * text, and every entry it had no business touching.
 *
 * @param root - Tree root.
 * @param scenario - The scenario that ran.
 * @param before - The tree before the run.
 * @returns Every run artifact except status and output.
 */
function runArtifacts(
  root: string,
  scenario: IScenario,
  before: ReadonlyMap<string, string>,
): Omit<IInstallRun, 'status' | 'output'> {
  const calls = stubCalls(root);
  const installed = installArtifacts(root, scenario);
  const keptSha256 = keptSha256Of(root);
  const ghOutputFile = join(root, GITHUB_OUTPUT_REL);
  const ghOutput = readIfPresent(ghOutputFile);
  const plantedText = plantedTextOf(root, scenario);
  const after = snapshotTree(root);
  const touched = touchedEntries(scenario, before, after);
  return { calls, ...installed, keptSha256, ghOutput, plantedText, touched };
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
  const before = snapshotTree(root);
  const env = scenarioEnv(root, scenario);
  const script = join(root, SCRIPT_REL);
  const result = spawnSync('bash', [script], { cwd: root, env, encoding: 'utf8' });
  const output = `${result.stdout}${result.stderr}`;
  const artifacts = runArtifacts(root, scenario, before);
  return { status: result.status ?? -1, output, ...artifacts };
}

/**
 * What the oracle reports when a stand-in action, not the script, changes a
 * scenario's tree, so a case can prove the oracle sees that kind of change.
 *
 * @param scenario - The scenario whose tree the action runs in.
 * @param act - Changes the tree, given its root; returns what it changed.
 * @returns The `touched` lines.
 */
function touchedBy(scenario: IScenario, act: (root: string) => string): readonly string[] {
  const root = makeTree(scenario);
  const before = snapshotTree(root);
  Atomics.wait(SETTLE_CELL, 0, 0, SETTLE_MS);
  act(root);
  const after = snapshotTree(root);
  return touchedEntries(scenario, before, after);
}

export type { AssetCache, BinaryEntry, IInstallRun, IScenario };
export {
  COLD,
  FOREIGN_ASSET,
  FOREIGN_TEXT,
  INSTALLED_BINARY,
  KEPT_REL,
  removeCreatedTrees,
  runInstall,
  SAMPLE_ASSET,
  SAMPLE_TAG,
  STUB_ASSET_SHA256,
  touchedBy,
};
