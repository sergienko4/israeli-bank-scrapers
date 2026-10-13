/**
 * Unit test for `.github/actions/install-camoufox/install.sh`.
 *
 * <p>The script is the one Camoufox install shared by the CI composite action
 * and the Docker CI mirror. Its contract: install exactly the tag pinned in
 * `browser-stack.json`, skip the download on a cache hit, use `gh` only when a
 * token exists (CI) and the public release URL otherwise (Docker), never print
 * the token, and install nothing when the manifest is invalid.
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

/** Token variables a developer shell may export; stripped so each case sets its own. */
const TOKEN_VARS: readonly string[] = ['GH_TOKEN', 'GITHUB_TOKEN'];
const INHERITED_ENV = Object.entries(process.env);
const TOKENLESS_ENV = INHERITED_ENV.filter(([key]): boolean => !TOKEN_VARS.includes(key));
const BASE_ENV: NodeJS.ProcessEnv = Object.fromEntries(TOKENLESS_ENV);

/**
 * Stub bodies. Each appends `<name> <argv>` to `$STUB_LOG`, then creates only
 * the file the real command would have produced. The `npx` stub plays
 * `camoufox-js fetch`: it fails unless `NPX_VERSION_JSON` says what to record.
 */
const STUBS: readonly (readonly [string, string])[] = [
  [
    'npx',
    'echo "npx $*" >> "$STUB_LOG"; [ -n "$NPX_VERSION_JSON" ] || exit 1; ' +
      'mkdir -p "$HOME/.cache/camoufox"; printf %s "$NPX_VERSION_JSON" > "$HOME/.cache/camoufox/version.json"; ' +
      ': > "$HOME/.cache/camoufox/camoufox-bin"',
  ],
  [
    'gh',
    'echo "gh $*" >> "$STUB_LOG"; while [ $# -gt 0 ]; do [ "$1" = --dir ] && : > "$2/a.zip"; shift; done',
  ],
  [
    'curl',
    'echo "curl $*" >> "$STUB_LOG"; while [ $# -gt 0 ]; do [ "$1" = -o ] && : > "$2"; shift; done',
  ],
  [
    'unzip',
    'echo "unzip $*" >> "$STUB_LOG"; while [ $# -gt 0 ]; do [ "$1" = -d ] && : > "$2/camoufox-bin"; shift; done',
  ],
];

/** One scenario: the manifest tag, the token, what camoufox-js does, and the cache. */
interface IScenario {
  readonly tag: string;
  readonly token: string;
  readonly npxVersionJson: string;
  readonly cachedVersionJson: string;
}

/** What one run of the script did. */
interface IInstallRun {
  readonly status: number;
  readonly output: string;
  readonly calls: readonly string[];
  readonly versionJson: string;
}

/** A cold cache, no token, and camoufox-js failing: the baseline scenario. */
const COLD: IScenario = { tag: SAMPLE_TAG, token: '', npxVersionJson: '', cachedVersionJson: '' };

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
 * Seed the cache as a previous run (or the CI cache restore) would leave it.
 *
 * @param root - Tree root.
 * @param versionJson - Contents of `version.json`.
 * @returns The cache directory.
 */
function seedCache(root: string, versionJson: string): string {
  const cache = join(root, CACHE_REL);
  mkdirSync(cache, { recursive: true });
  const versionFile = join(cache, 'version.json');
  writeFileSync(versionFile, versionJson);
  const binary = join(cache, 'camoufox-bin');
  writeFileSync(binary, '');
  return cache;
}

/**
 * Build a tree for one scenario: script, validator, manifest, stubs, cache.
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
  if (scenario.cachedVersionJson !== '') seedCache(root, scenario.cachedVersionJson);
  return root;
}

/**
 * The environment the script runs with: stubs first on `PATH`, a private
 * `HOME`, and only the scenario's token.
 *
 * @param root - Tree root.
 * @param scenario - The scenario.
 * @returns The environment.
 */
function scenarioEnv(root: string, scenario: IScenario): NodeJS.ProcessEnv {
  const bin = join(root, 'bin');
  const path = `${bin}${delimiter}${BASE_ENV.PATH ?? ''}`;
  const home = join(root, 'home');
  const stubLog = join(root, 'stub.log');
  const token = scenario.token === '' ? {} : { GH_TOKEN: scenario.token };
  const npx = { NPX_VERSION_JSON: scenario.npxVersionJson };
  return { ...BASE_ENV, ...token, ...npx, PATH: path, HOME: home, STUB_LOG: stubLog };
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
 * What a finished run left behind: the stub call log and `version.json`.
 *
 * @param root - Tree root.
 * @returns Stub calls in order, and the recorded `version.json` (or `''`).
 */
function runArtifacts(root: string): Pick<IInstallRun, 'calls' | 'versionJson'> {
  const logFile = join(root, 'stub.log');
  const log = readIfPresent(logFile);
  const calls = log.split('\n').filter(line => line !== '');
  const versionFile = join(root, CACHE_REL, 'version.json');
  const versionJson = readIfPresent(versionFile);
  return { calls, versionJson };
}

/**
 * Run the real script for one scenario.
 *
 * @param scenario - The scenario.
 * @returns Exit status (-1 when killed), combined output, stub calls, and
 *   the recorded `version.json`.
 */
function runInstall(scenario: IScenario): IInstallRun {
  const root = makeTree(scenario);
  const env = scenarioEnv(root, scenario);
  const script = join(root, SCRIPT_REL);
  const result = spawnSync('bash', [script], { env, encoding: 'utf8' });
  const output = `${result.stdout}${result.stderr}`;
  const artifacts = runArtifacts(root);
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
    const ghCall = `gh release download ${SAMPLE_TAG} --repo daijro/camoufox`;
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
});
