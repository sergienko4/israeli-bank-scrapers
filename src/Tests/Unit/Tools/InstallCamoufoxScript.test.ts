/**
 * Unit test for `.github/actions/install-camoufox/install.sh`.
 *
 * <p>The script is the one Camoufox installer shared by the CI composite
 * action and the Docker CI mirror. Its contract: install exactly the tag pinned in
 * `browser-stack.json` into the directory camoufox-js launches from, skip the
 * download only on a cache that holds the pin AND a usable binary, download
 * the pin exactly once on a miss and never through `camoufox-js fetch` (which
 * resolves its own newest release, not the pin), use `gh` only when a token
 * exists (CI) and the public release URL otherwise (Docker), extract only an
 * asset that hashes to the pinned SHA-256 and touch the cache only after that
 * check, refuse to replace an install dir that is relative, is `$HOME`, or
 * holds anything but a Camoufox install, never print the token, never record
 * a version it did not install, leave no temp files, and install nothing
 * when the manifest is invalid.
 *
 * <p>Each case runs the REAL script in a throwaway tree that mirrors the repo
 * layout (script + validator + its own `browser-stack.json`), with `npx`,
 * `gh`, `curl` and `unzip` replaced by stubs on `PATH`. A stub records its
 * argv and fakes only the file it would have produced, so no case touches the
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
const SAMPLE_VERSION_JSON = '{"version":"100.0.0","release":"beta.1"}';
/** A cache left by another release, e.g. camoufox-js's own newest one. */
const OTHER_VERSION_JSON = '{"version":"156.0.1","release":"beta.36"}';
const SAMPLE_ASSET = 'camoufox-100.0.0-beta.1-lin.x86_64.zip';
const SAMPLE_ASSET_URL = `https://github.com/daijro/camoufox/releases/download/${SAMPLE_TAG}/${SAMPLE_ASSET}`;
const TOKEN = 'fake-token-that-must-never-print';
/** SHA-256 of the empty asset the `gh` and `curl` stubs download. */
const STUB_ASSET_SHA256 = createHash('sha256').update('').digest('hex');
/** A well-formed digest that no stub download matches. */
const FOREIGN_SHA256 = createHash('sha256').update('another asset').digest('hex');
/** Tree-relative `CAMOUFOX_INSTALL_DIR` for the relocation case. */
const CUSTOM_DIR_REL = 'opt/camoufox';
/** A file the user keeps in the install dir; a refused run must not touch it. */
const FOREIGN_FILE_REL = `${CUSTOM_DIR_REL}/notes.txt`;
const FOREIGN_TEXT = 'not camoufox';
/** A `version.json` that some other tool wrote: not tag-shaped. */
const FOREIGN_VERSION_JSON = '{"name":"notes","version":"1.0.0"}';

/**
 * Variables a developer shell may export that would change the script's
 * behaviour; stripped so each case sets only its own.
 */
const STRIPPED_VARS: readonly string[] = ['GH_TOKEN', 'GITHUB_TOKEN', 'CAMOUFOX_INSTALL_DIR'];
const INHERITED_ENV = Object.entries(process.env);
const CLEAN_ENV = INHERITED_ENV.filter(([key]): boolean => !STRIPPED_VARS.includes(key));
const BASE_ENV: NodeJS.ProcessEnv = Object.fromEntries(CLEAN_ENV);

/**
 * Stub bodies. Each appends `<name> <argv>` to `$STUB_LOG`, then creates only
 * the file the real command would have produced. The `npx` stub is a
 * tripwire: it only logs and fails, so a `camoufox-js fetch` shows in the log.
 * `gh` writes the file its `--pattern` names, so a glob pattern would not
 * produce the asset the script unzips; `unzip` fails on a missing archive and
 * puts at `camoufox-bin` what `UNZIP_BINARY` names: a `file`, a `directory`,
 * or `nothing`.
 */
const STUBS: readonly (readonly [string, string])[] = [
  ['npx', 'echo "npx $*" >> "$STUB_LOG"; exit 1'],
  [
    'gh',
    'echo "gh $*" >> "$STUB_LOG"; while [ $# -gt 0 ]; do case "$1" in ' +
      '--pattern) p="$2" ;; --dir) d="$2" ;; esac; shift; done; : > "$d/$p"',
  ],
  [
    'curl',
    'echo "curl $*" >> "$STUB_LOG"; while [ $# -gt 0 ]; do [ "$1" = -o ] && : > "$2"; shift; done',
  ],
  [
    'unzip',
    'echo "unzip $*" >> "$STUB_LOG"; [ -f "$2" ] || exit 9; ' +
      'while [ $# -gt 0 ]; do [ "$1" = -d ] && d="$2"; shift; done; ' +
      'case "$UNZIP_BINARY" in file) printf ELF > "$d/camoufox-bin" ;; ' +
      'directory) mkdir -p "$d/camoufox-bin/lib" ;; esac; exit 0',
  ],
];

/** State of a seeded cache's `camoufox-bin`. */
type CachedBinary = 'ok' | 'empty' | 'not-executable' | 'missing' | 'directory';

/** What sits at `camoufox-bin`, in a seeded cache or an extracted archive. */
type BinaryEntry = 'file' | 'directory' | 'nothing';

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
 * Make `camoufox-bin` a non-empty, searchable directory: `-s` and `-x` both
 * hold for it, so only a regular-file check rejects it.
 *
 * @param file - Binary path.
 * @returns The binary path.
 */
function makeBinaryDirectory(file: string): string {
  const inner = join(file, 'lib');
  mkdirSync(inner, { recursive: true, mode: 0o755 });
  return file;
}

/** How each state is seeded: the entry, a file's contents, a file's mode. */
const BINARY_SEEDS: Readonly<Record<CachedBinary, readonly [BinaryEntry, string, number]>> = {
  ok: ['file', 'ELF', 0o755],
  empty: ['file', '', 0o755],
  'not-executable': ['file', 'ELF', 0o644],
  missing: ['nothing', '', 0],
  directory: ['directory', '', 0],
};

/** Cached-binary states that must count as a cache miss. */
const UNUSABLE_BINARIES: readonly CachedBinary[] = [
  'empty',
  'not-executable',
  'missing',
  'directory',
];

/** Archive contents the script must refuse to record as installed. */
const UNUSABLE_ARCHIVES: readonly BinaryEntry[] = ['nothing', 'directory'];

/**
 * One scenario: the manifest tag and digest, the token, the cache, what the
 * release archive holds, any install-dir override and whether it is passed
 * absolute or relative to the run's working directory (the tree root), and
 * a tree-relative `foreign` entry planted before the run: a file holding
 * `FOREIGN_TEXT`, or an empty directory when it ends in `/`.
 */
interface IScenario {
  readonly tag: string;
  readonly sha256: string;
  readonly token: string;
  readonly cachedVersionJson: string;
  readonly cachedBinary: CachedBinary;
  readonly archiveBinary: BinaryEntry;
  readonly installDir: string;
  readonly installDirAs: 'absolute' | 'relative';
  readonly foreign: string;
}

/** What one run of the script did. */
interface IInstallRun {
  readonly status: number;
  readonly output: string;
  readonly calls: readonly string[];
  readonly versionJson: string;
  readonly tempLeft: number;
  readonly homeCacheExists: boolean;
  readonly foreignText: string;
}

/** A cold cache and no token: the baseline scenario. */
const COLD: IScenario = {
  tag: SAMPLE_TAG,
  sha256: STUB_ASSET_SHA256,
  token: '',
  cachedVersionJson: '',
  cachedBinary: 'ok',
  archiveBinary: 'file',
  installDir: '',
  installDirAs: 'absolute',
  foreign: '',
};

/** Commands that download a release asset. */
const DOWNLOADERS: readonly string[] = ['gh', 'curl'];

/** Each download path and the token that selects it. */
const DOWNLOAD_PATHS: readonly { readonly via: string; readonly token: string }[] = [
  { via: 'curl', token: '' },
  { via: 'gh', token: TOKEN },
];

/** Every kind of cache miss; each must download the pinned asset exactly once. */
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
 * Install dirs a miss must refuse to replace. Each row breaks exactly one
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

/** Install dirs a miss may replace: empty, or marked by either Camoufox entry. */
const REPLACEABLE: readonly { readonly label: string; readonly scenario: IScenario }[] = [
  {
    label: 'an empty directory',
    scenario: { ...COLD, installDir: CUSTOM_DIR_REL, foreign: `${CUSTOM_DIR_REL}/` },
  },
  { label: 'a dir marked by camoufox-bin', scenario: { ...STALE_CUSTOM, cachedVersionJson: '{}' } },
  {
    label: 'a dir marked by a tag-shaped version.json',
    scenario: { ...STALE_CUSTOM, cachedBinary: 'missing' },
  },
];

/** Every tree this suite created, removed in `afterAll`. */
const CREATED: string[] = [];

afterAll(() => {
  for (const root of CREATED) rmSync(root, { recursive: true, force: true });
  const survivors = CREATED.filter(root => existsSync(root));
  const count = String(survivors.length);
  if (survivors.length > 0) throw new ScraperError(`left ${count} temp trees`);
});

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
  if (entry === 'directory') makeBinaryDirectory(binary);
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
 * Create `HOME` and the private temp dir, seed the cache the scenario starts
 * with, and plant its foreign entry.
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
  const cache = cacheDirOf(root, scenario);
  if (scenario.cachedVersionJson !== '') seedCache(cache, scenario);
  if (scenario.foreign !== '') plantForeign(root, scenario.foreign);
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
  return { CAMOUFOX_INSTALL_DIR: value };
}

/**
 * The environment the script runs with: stubs first on `PATH`, a private
 * `HOME` and `TMPDIR`, and only the scenario's token and install dir.
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
  const stubLog = join(root, 'stub.log');
  const stubs = { UNZIP_BINARY: scenario.archiveBinary, STUB_LOG: stubLog };
  return { ...BASE_ENV, ...token, ...installDir, ...stubs, HOME: home, TMPDIR: temp, PATH: path };
}

/**
 * Read a file the run may or may not have produced.
 *
 * @param file - File path.
 * @returns Its contents, or `''` when absent.
 */
function readIfPresent(file: string): string {
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8');
}

/**
 * The text of the scenario's foreign file after the run.
 *
 * @param root - Tree root.
 * @param foreign - Tree-relative path; `''` or a trailing `/` is no file.
 * @returns Its contents, or `''` when there is no such file.
 */
function foreignTextOf(root: string, foreign: string): string {
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
 * What a finished run left behind: the stub call log, `version.json` in the
 * install dir, leftover temp entries, whether the default cache exists, and
 * the foreign file's text.
 *
 * @param root - Tree root.
 * @param scenario - The scenario that ran.
 * @returns Every run artifact except status and output.
 */
function runArtifacts(root: string, scenario: IScenario): Omit<IInstallRun, 'status' | 'output'> {
  const calls = stubCalls(root);
  const cache = cacheDirOf(root, scenario);
  const versionFile = join(cache, 'version.json');
  const versionJson = readIfPresent(versionFile);
  const temp = join(root, 'tmp');
  const tempLeft = readdirSync(temp).length;
  const homeCache = join(root, CACHE_REL);
  const foreignText = foreignTextOf(root, scenario.foreign);
  return { calls, versionJson, tempLeft, homeCacheExists: existsSync(homeCache), foreignText };
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

describe('install-camoufox/install.sh', () => {
  it('[ICS-1] a cache hit on the pinned tag downloads nothing', () => {
    const run = runInstall({ ...COLD, token: TOKEN, cachedVersionJson: SAMPLE_VERSION_JSON });
    expect(run.status).toBe(0);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain(`Camoufox ${SAMPLE_TAG} already cached`);
  });

  it('[ICS-2] with a token a miss downloads the pinned asset via gh', () => {
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
    expect(run.tempLeft).toBe(0);
  });

  it('[ICS-4] a cache whose version differs from the pin is replaced', () => {
    const run = runInstall({ ...COLD, cachedVersionJson: OTHER_VERSION_JSON });
    expect(run.status).toBe(0);
    expect(run.calls[0]).toContain(SAMPLE_ASSET_URL);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
  });

  it.each(MISSES)('[ICS-5] a miss ($label) downloads the pin once, never via camoufox-js', row => {
    const run = runInstall(row.scenario);
    const tools = run.calls.map(call => call.split(' ')[0]);
    const downloads = tools.filter(tool => DOWNLOADERS.includes(tool));
    expect(run.status).toBe(0);
    expect(tools).not.toContain('npx');
    expect(downloads).toHaveLength(1);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
  });

  it('[ICS-6] an invalid manifest fails closed before any install step', () => {
    const run = runInstall({ ...COLD, tag: 'latest', token: TOKEN });
    expect(run.status).toBe(2);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain('MANIFEST-INVALID /camoufox/tag');
    expect(run.versionJson).toBe('');
  });

  it.each(UNUSABLE_BINARIES)('[ICS-7] a pinned version.json with a %s binary is a miss', state => {
    const run = runInstall({
      ...COLD,
      cachedVersionJson: SAMPLE_VERSION_JSON,
      cachedBinary: state,
    });
    const tools = run.calls.map(call => call.split(' ')[0]);
    expect(run.status).toBe(0);
    expect(tools).toEqual(['curl', 'unzip']);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
  });

  it.each(UNUSABLE_ARCHIVES)(
    '[ICS-8] an archive extracting %s as camoufox-bin fails and records no version',
    content => {
      const run = runInstall({ ...COLD, archiveBinary: content });
      expect(run.status).toBe(1);
      expect(run.output).toContain(
        `ERROR: no usable camoufox-bin after extracting ${SAMPLE_ASSET}`,
      );
      expect(run.versionJson).toBe('');
      expect(run.tempLeft).toBe(0);
    },
  );

  it('[ICS-9] CAMOUFOX_INSTALL_DIR is where the pin lands, not the per-user cache', () => {
    const run = runInstall({ ...COLD, installDir: CUSTOM_DIR_REL });
    expect(run.status).toBe(0);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
    expect(run.homeCacheExists).toBe(false);
  });

  it('[ICS-10] a pinned cache under CAMOUFOX_INSTALL_DIR is a hit', () => {
    const custom = { installDir: CUSTOM_DIR_REL, cachedVersionJson: SAMPLE_VERSION_JSON };
    const run = runInstall({ ...COLD, ...custom });
    expect(run.status).toBe(0);
    expect(run.calls).toEqual([]);
    expect(run.homeCacheExists).toBe(false);
  });

  it.each(DOWNLOAD_PATHS)(
    '[ICS-11] an asset off the pinned SHA-256 (via $via) fails before the cache is touched',
    ({ via, token }) => {
      const stale = { cachedVersionJson: OTHER_VERSION_JSON, sha256: FOREIGN_SHA256 };
      const run = runInstall({ ...COLD, ...stale, token });
      const tools = run.calls.map(call => call.split(' ')[0]);
      const pinned = `has sha256 ${STUB_ASSET_SHA256}, but browser-stack.json pins ${FOREIGN_SHA256}`;
      expect(run.status).toBe(1);
      expect(tools).toEqual([via]);
      expect(run.output).toContain(`ERROR: ${SAMPLE_ASSET} ${pinned}`);
      expect(run.versionJson).toBe(OTHER_VERSION_JSON);
      expect(run.tempLeft).toBe(0);
    },
  );

  it("[ICS-12] GitHub's sha256:-prefixed digest form fails closed as MANIFEST-INVALID", () => {
    const run = runInstall({ ...COLD, sha256: `sha256:${STUB_ASSET_SHA256}`, token: TOKEN });
    expect(run.status).toBe(2);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain('MANIFEST-INVALID /camoufox/linuxX64Sha256');
  });

  it.each(REFUSED)('[ICS-13] a miss refuses to replace $label, before downloading', row => {
    const run = runInstall(row.scenario);
    expect(run.status).toBe(1);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain('ERROR: refusing to replace ');
    expect(run.foreignText).toBe(FOREIGN_TEXT);
    expect(run.versionJson).toBe(row.scenario.cachedVersionJson);
  });

  it.each(REPLACEABLE)('[ICS-14] a miss replaces $label with the pin', row => {
    const run = runInstall(row.scenario);
    expect(run.status).toBe(0);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
    expect(run.foreignText).toBe('');
  });
});
