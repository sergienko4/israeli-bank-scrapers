/**
 * Unit test for `.github/actions/install-camoufox/install.sh`.
 *
 * <p>The script is the one Camoufox install shared by the CI composite action
 * and the Docker CI mirror. Its contract: install exactly the tag pinned in
 * `browser-stack.json` into the directory camoufox-js launches from, skip the
 * download only on a cache that holds the pin AND a usable binary, use `gh`
 * only when a token exists (CI) and the public release URL otherwise
 * (Docker), never print the token, never record a version it did not
 * install, leave no temp files, and install nothing when the manifest is
 * invalid.
 *
 * <p>Each case runs the REAL script in a throwaway tree that mirrors the repo
 * layout (script + validator + its own `browser-stack.json`), with `npx`,
 * `gh`, `curl` and `unzip` replaced by stubs on `PATH`. A stub records its
 * argv and fakes only the file it would have produced, so no case touches the
 * network and every download decision is visible in the call log.
 */

import { spawnSync } from 'node:child_process';
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
/** What camoufox-js records when it resolves its own newest release instead. */
const OTHER_VERSION_JSON = '{"version":"156.0.1","release":"beta.36"}';
const SAMPLE_ASSET = 'camoufox-100.0.0-beta.1-lin.x86_64.zip';
const SAMPLE_ASSET_URL = `https://github.com/daijro/camoufox/releases/download/${SAMPLE_TAG}/${SAMPLE_ASSET}`;
const TOKEN = 'fake-token-that-must-never-print';
/** Tree-relative `CAMOUFOX_INSTALL_DIR` for the relocation case. */
const CUSTOM_DIR_REL = 'opt/camoufox';

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
 * the file the real command would have produced. The `npx` stub plays
 * `camoufox-js fetch`, installing where camoufox-js would (the override, else
 * the per-user cache); it fails unless `NPX_VERSION_JSON` says what to record.
 * `gh` writes the file its `--pattern` names, so a glob pattern would not
 * produce the asset the script unzips; `unzip` fails on a missing archive and
 * extracts a browser only when `UNZIP_BINARY` is set.
 */
const STUBS: readonly (readonly [string, string])[] = [
  [
    'npx',
    'echo "npx $*" >> "$STUB_LOG"; [ -n "$NPX_VERSION_JSON" ] || exit 1; ' +
      'd="$HOME/.cache/camoufox"; [ -n "$CAMOUFOX_INSTALL_DIR" ] && d="$CAMOUFOX_INSTALL_DIR"; ' +
      'mkdir -p "$d"; printf %s "$NPX_VERSION_JSON" > "$d/version.json"; ' +
      'printf ELF > "$d/camoufox-bin"; chmod 755 "$d/camoufox-bin"',
  ],
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
      '[ -n "$UNZIP_BINARY" ] && printf ELF > "$d/camoufox-bin"; exit 0',
  ],
];

/** State of a seeded cache's `camoufox-bin`. */
type CachedBinary = 'ok' | 'empty' | 'not-executable' | 'missing';

/** How each state is seeded: contents and mode (`-1` = not written). */
const BINARY_SEEDS: Readonly<Record<CachedBinary, readonly [string, number]>> = {
  ok: ['ELF', 0o755],
  empty: ['', 0o755],
  'not-executable': ['ELF', 0o644],
  missing: ['', -1],
};

/** Cached-binary states that must count as a cache miss. */
const UNUSABLE_BINARIES: readonly CachedBinary[] = ['empty', 'not-executable', 'missing'];

/**
 * One scenario: the manifest tag, the token, what camoufox-js does, the
 * cache, what the release archive holds, and any install-dir override.
 */
interface IScenario {
  readonly tag: string;
  readonly token: string;
  readonly npxVersionJson: string;
  readonly cachedVersionJson: string;
  readonly cachedBinary: CachedBinary;
  readonly archiveHasBinary: boolean;
  readonly installDir: string;
}

/** What one run of the script did. */
interface IInstallRun {
  readonly status: number;
  readonly output: string;
  readonly calls: readonly string[];
  readonly versionJson: string;
  readonly tempLeft: number;
  readonly homeCacheExists: boolean;
}

/** A cold cache, no token, and camoufox-js failing: the baseline scenario. */
const COLD: IScenario = {
  tag: SAMPLE_TAG,
  token: '',
  npxVersionJson: '',
  cachedVersionJson: '',
  cachedBinary: 'ok',
  archiveHasBinary: true,
  installDir: '',
};

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
 * Write the tree's `browser-stack.json`, valid unless the tag is not.
 *
 * @param root - Tree root.
 * @param tag - Value of `camoufox.tag`.
 * @returns The manifest path.
 */
function writeManifest(root: string, tag: string): string {
  const meta = { $comment: 'Install-script test manifest.', acceptedDeltas: [] };
  const doc = { ...meta, camoufox: { tag }, playwrightCore: { testedMinor: '1.63' } };
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
  const [content, mode] = BINARY_SEEDS[scenario.cachedBinary];
  if (mode < 0) return cache;
  const binary = join(cache, 'camoufox-bin');
  writeFileSync(binary, content);
  chmodSync(binary, mode);
  return cache;
}

/**
 * Create the private temp dir and seed the cache the scenario starts with.
 *
 * @param root - Tree root.
 * @param scenario - The scenario.
 * @returns The scenario's install directory.
 */
function prepareState(root: string, scenario: IScenario): string {
  const temp = join(root, 'tmp');
  mkdirSync(temp);
  const cache = cacheDirOf(root, scenario);
  if (scenario.cachedVersionJson !== '') seedCache(cache, scenario);
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
  writeManifest(root, scenario.tag);
  writeStubs(root);
  prepareState(root, scenario);
  return root;
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
  const cache = cacheDirOf(root, scenario);
  const token = scenario.token === '' ? {} : { GH_TOKEN: scenario.token };
  const installDir = scenario.installDir === '' ? {} : { CAMOUFOX_INSTALL_DIR: cache };
  const stubLog = join(root, 'stub.log');
  const stubs = {
    NPX_VERSION_JSON: scenario.npxVersionJson,
    UNZIP_BINARY: scenario.archiveHasBinary ? '1' : '',
    STUB_LOG: stubLog,
  };
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
 * What a finished run left behind: the stub call log, `version.json` in the
 * install dir, leftover temp entries, and whether the default cache exists.
 *
 * @param root - Tree root.
 * @param scenario - The scenario that ran.
 * @returns Every run artifact except status and output.
 */
function runArtifacts(root: string, scenario: IScenario): Omit<IInstallRun, 'status' | 'output'> {
  const logFile = join(root, 'stub.log');
  const log = readIfPresent(logFile);
  const calls = log.split('\n').filter(line => line !== '');
  const cache = cacheDirOf(root, scenario);
  const versionFile = join(cache, 'version.json');
  const versionJson = readIfPresent(versionFile);
  const temp = join(root, 'tmp');
  const tempLeft = readdirSync(temp).length;
  const homeCache = join(root, CACHE_REL);
  return { calls, versionJson, tempLeft, homeCacheExists: existsSync(homeCache) };
}

/**
 * Run the real script for one scenario.
 *
 * @param scenario - The scenario.
 * @returns Exit status (-1 when killed), combined output, and the run's
 *   artifacts.
 */
function runInstall(scenario: IScenario): IInstallRun {
  const root = makeTree(scenario);
  const env = scenarioEnv(root, scenario);
  const script = join(root, SCRIPT_REL);
  const result = spawnSync('bash', [script], { env, encoding: 'utf8' });
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

  it('[ICS-2] a miss where camoufox-js installs another release re-installs the pin via gh', () => {
    const run = runInstall({ ...COLD, token: TOKEN, npxVersionJson: OTHER_VERSION_JSON });
    const ghCall = `gh release download ${SAMPLE_TAG} --repo daijro/camoufox --pattern ${SAMPLE_ASSET} `;
    expect(run.status).toBe(0);
    expect(run.calls).toHaveLength(3);
    expect(run.calls[1]).toContain(ghCall);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
    expect(run.output).not.toContain(TOKEN);
  });

  it('[ICS-3] without a token the pinned asset comes from the public release URL', () => {
    const run = runInstall(COLD);
    const tools = run.calls.map(call => call.split(' ')[0]);
    expect(run.status).toBe(0);
    expect(tools).toEqual(['npx', 'curl', 'unzip']);
    expect(run.calls[1]).toContain(SAMPLE_ASSET_URL);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
    expect(run.tempLeft).toBe(0);
  });

  it('[ICS-4] a cache whose version differs from the pin is replaced', () => {
    const run = runInstall({ ...COLD, cachedVersionJson: OTHER_VERSION_JSON });
    expect(run.status).toBe(0);
    expect(run.calls[1]).toContain(SAMPLE_ASSET_URL);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
  });

  it('[ICS-5] camoufox-js installing the pinned release itself needs no asset download', () => {
    const run = runInstall({ ...COLD, token: TOKEN, npxVersionJson: SAMPLE_VERSION_JSON });
    expect(run.status).toBe(0);
    expect(run.calls).toEqual(['npx @hieutran094/camoufox-js fetch']);
    expect(run.output).toContain(`Camoufox ${SAMPLE_TAG} installed via camoufox-js`);
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
    expect(tools).toEqual(['npx', 'curl', 'unzip']);
    expect(run.versionJson).toBe(SAMPLE_VERSION_JSON);
  });

  it('[ICS-8] an archive without camoufox-bin fails and records no version', () => {
    const run = runInstall({ ...COLD, archiveHasBinary: false });
    expect(run.status).toBe(1);
    expect(run.output).toContain(
      `ERROR: camoufox-bin missing or empty after extracting ${SAMPLE_ASSET}`,
    );
    expect(run.versionJson).toBe('');
    expect(run.tempLeft).toBe(0);
  });

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
});
