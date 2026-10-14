/**
 * Install-camoufox wiring.
 *
 * <p>`InstallCamoufoxScript` proves what `install.sh` does; this suite pins
 * that both of its consumers still run it and that the CI cache follows the
 * manifest. The composite action must resolve the tag and asset digest
 * through the manifest validator; restore the release asset under a key
 * prefixed by both outputs and unique to the run, so the newest entry wins
 * and a re-download supersedes a corrupt one; run `install.sh` with the
 * token and that asset dir; save only when `install.sh` reports a download;
 * and never cache the install dir, which `install.sh` does not trust. The
 * Docker CI mirror must copy what `install.sh` reads and run it as its only
 * Camoufox install, tokenless, so it needs no GitHub CLI and must not ship
 * one. No consumer may spell the pinned tag or digest: a literal there
 * would survive a manifest bump, so a static cache key would keep restoring
 * the old asset, or Docker would install a different one from CI. Every curl
 * in `install.sh` and the Docker mirror bounds its connect and total time,
 * so a stalled download fails rather than hangs the job or the build.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const ACTION_REL = '.github/actions/install-camoufox/action.yml';
const SCRIPT_REL = '.github/actions/install-camoufox/install.sh';
const DOCKERFILE_REL = 'docker/Dockerfile.ci-mirror';
const MANIFEST_REL = 'browser-stack.json';
const VALIDATOR_REL = 'scripts/browser-stack/manifest.mjs';

const RESOLVE_ID = 'camoufox-tag';
const RESTORE_ID = 'asset-cache';
const INSTALL_ID = 'install';
const RESTORE_ACTION = 'actions/cache/restore@';
const SAVE_ACTION = 'actions/cache/save@';
const RESOLVED = `steps.${RESOLVE_ID}.outputs`;
/** Every entry for the pinned tag and digest; restore takes the newest. */
const ASSET_KEY_PREFIX = `camoufox-asset-\${{ ${RESOLVED}.tag }}-\${{ ${RESOLVED}.sha256 }}-`;
/** The run's own key, so its save never collides with an older entry. */
const RUN_KEY = `${ASSET_KEY_PREFIX}\${{ github.run_id }}-\${{ github.run_attempt }}`;
const SAVE_KEY = `\${{ steps.${RESTORE_ID}.outputs.cache-primary-key }}`;
const SAVE_IF = `steps.${INSTALL_ID}.outputs.downloaded == 'true'`;
const ASSET_DIR = '${{ runner.temp }}/camoufox-asset';
const TOKEN_INPUT = '${{ inputs.gh-token }}';

/**
 * The resolve step's whole script: the validator prints the tag and the
 * digest (or fails closed) and the step exports exactly those as the outputs
 * the key reads.
 */
const RESOLVE_RUN = [
  'set -euo pipefail',
  `validator="\${GITHUB_WORKSPACE}/${VALIDATOR_REL}"`,
  'tag=$(node "$validator" tag)',
  'sha256=$(node "$validator" sha256)',
  'echo "tag=${tag}" >> "$GITHUB_OUTPUT"',
  'echo "sha256=${sha256}" >> "$GITHUB_OUTPUT"',
  '',
].join('\n');

/** `install.sh`'s default install directory, below `$HOME`. */
const DEFAULT_DIR_RE = /INSTALL_DIR="\$\{CAMOUFOX_INSTALL_DIR:-\$HOME\/(?<dir>[^}"]+)\}"/u;
/** A Dockerfile line continuation plus the next line's indent. */
const CONTINUATION_RE = /\\\n\s*/gu;
/** A Dockerfile instruction that starts a build stage. */
const FROM_RE = /^FROM\s/iu;
/**
 * What only the token path of `install.sh` needs: the GitHub CLI, its apt
 * source, or a token.
 */
const GH_PATH_RE = /\bgh\b|cli\.github\.com|GH_TOKEN/u;

/**
 * The Docker mirror's Camoufox instructions, in order: the files
 * `install.sh` reads (itself, the validator, the manifest), then the run.
 */
const DOCKER_INSTALL: readonly string[] = [
  `COPY ${MANIFEST_REL} ./`,
  `COPY ${VALIDATOR_REL} scripts/browser-stack/`,
  `COPY ${SCRIPT_REL} .github/actions/install-camoufox/`,
  `RUN bash ${SCRIPT_REL}`,
];

/** Every file that consumes the pinned tag without owning it. */
const CONSUMERS: readonly string[] = [ACTION_REL, SCRIPT_REL, DOCKERFILE_REL];

/** A curl call, from `curl` to the end of its pipeline segment. */
const CURL_CALL_RE = /\bcurl\s+-[^|;&\n]*/gu;
/** The options that bound how long a curl download may hang. */
const CURL_TIME_BOUNDS: readonly string[] = ['--connect-timeout ', '--max-time '];

/** One step of the composite. */
interface IStep {
  readonly id?: string;
  readonly if?: string;
  readonly shell?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Readonly<Record<string, string>>;
  readonly env?: Readonly<Record<string, string>>;
}

/** The composite `action.yml`. */
interface IComposite {
  readonly runs: { readonly steps: readonly IStep[] };
}

/** How a step is recognised: the role, the field read, and what it holds. */
const ROLE_MARKERS: readonly (readonly [string, 'id' | 'uses' | 'run', string])[] = [
  ['resolve', 'id', RESOLVE_ID],
  ['restore', 'uses', RESTORE_ACTION],
  ['install', 'run', SCRIPT_REL],
  ['save', 'uses', SAVE_ACTION],
];

/**
 * Read one repo file.
 *
 * @param rel - Repo-relative path.
 * @returns Its contents.
 */
function readRepoFile(rel: string): string {
  const file = join(REPO_ROOT, rel);
  return readFileSync(file, 'utf8');
}

/**
 * The composite's steps.
 *
 * @returns Steps in order.
 */
function actionSteps(): readonly IStep[] {
  const text = readRepoFile(ACTION_REL);
  return (parse(text) as IComposite).runs.steps;
}

/**
 * The role a step plays in the install.
 *
 * @param step - The step.
 * @returns `resolve`, `restore`, `install` or `save`; `other` for anything else.
 */
function roleOf(step: IStep): string {
  const hit = ROLE_MARKERS.find(([, field, needle]) => (step[field] ?? '').includes(needle));
  return hit?.[0] ?? 'other';
}

/**
 * The composite's step with a given role.
 *
 * @param role - The role.
 * @returns The first such step, or an empty step when there is none.
 */
function stepWithRole(role: string): IStep {
  return actionSteps().find(step => roleOf(step) === role) ?? {};
}

/**
 * `install.sh`'s default install directory, written as a home-relative path.
 *
 * @returns `~/<dir>`, or `''` when the default is not declared as expected.
 */
function scriptDefaultDir(): string {
  const text = readRepoFile(SCRIPT_REL);
  const dir = DEFAULT_DIR_RE.exec(text)?.groups?.dir ?? '';
  return dir === '' ? '' : `~/${dir}`;
}

/**
 * The Dockerfile's instructions: comments dropped, continuations joined.
 *
 * @returns One trimmed instruction per entry.
 */
function dockerInstructions(): readonly string[] {
  const lines = readRepoFile(DOCKERFILE_REL).split('\n');
  const code = lines.filter(line => !line.trimStart().startsWith('#'));
  const joined = code.join('\n').replaceAll(CONTINUATION_RE, ' ');
  const instructions = joined.split('\n').map(line => line.trim());
  return instructions.filter(line => line !== '');
}

/**
 * The instructions of the Dockerfile's final stage. Only that stage is the
 * image; Camoufox installed in an earlier stage the final one does not build
 * on would be left out, so the install is checked there (conservatively: a
 * final stage that builds on an earlier one fails too).
 *
 * @returns The final stage, starting with its `FROM`.
 */
function finalDockerStage(): readonly string[] {
  const instructions = dockerInstructions();
  const starts = instructions.map(line => FROM_RE.test(line));
  const last = starts.lastIndexOf(true);
  const first = Math.max(last, 0);
  return instructions.slice(first);
}

/**
 * The code lines of `install.sh`: comments dropped.
 *
 * @returns One trimmed line per entry.
 */
function scriptCode(): readonly string[] {
  const lines = readRepoFile(SCRIPT_REL).split('\n');
  const trimmed = lines.map(line => line.trim());
  return trimmed.filter(line => !line.startsWith('#'));
}

/** How to read the code of each file that downloads with curl. */
const DOWNLOADER_CODE: Readonly<Record<string, () => readonly string[]>> = {
  [SCRIPT_REL]: scriptCode,
  [DOCKERFILE_REL]: dockerInstructions,
};
const DOWNLOADERS = Object.keys(DOWNLOADER_CODE);

/**
 * Every curl call in a file's code.
 *
 * @param rel - A key of `DOWNLOADER_CODE`.
 * @returns Each call, up to the end of its pipeline segment.
 */
function curlCalls(rel: string): readonly string[] {
  const code = DOWNLOADER_CODE[rel]();
  return code.flatMap(line => line.match(CURL_CALL_RE) ?? []);
}

/** The `camoufox` block `browser-stack.json` pins. */
interface IPinnedCamoufox {
  readonly tag: string;
  readonly linuxX64Sha256: string;
}

/**
 * The Camoufox release `browser-stack.json` pins.
 *
 * @returns The tag, `v`-prefixed, and its asset digest.
 */
function pinnedCamoufox(): IPinnedCamoufox {
  const text = readRepoFile(MANIFEST_REL);
  const doc = JSON.parse(text) as { readonly camoufox: IPinnedCamoufox };
  return doc.camoufox;
}

describe('install-camoufox wiring', () => {
  it('[ICW-1] the action resolves the tag, restores the asset, installs, then saves', () => {
    const roles = actionSteps().map(roleOf);
    expect(roles).toEqual(['resolve', 'restore', 'install', 'save']);
  });

  it('[ICW-2] the step the cache keys read exports the validated tag and digest', () => {
    const resolve = stepWithRole('resolve');
    expect(resolve).toMatchObject({ id: RESOLVE_ID, shell: 'bash', run: RESOLVE_RUN });
  });

  it('[ICW-3] the asset is restored newest-first and saved per run only after a download', () => {
    const restore = stepWithRole('restore');
    const save = stepWithRole('save');
    const restoreWith = { path: ASSET_DIR, key: RUN_KEY, 'restore-keys': ASSET_KEY_PREFIX };
    expect(restore).toMatchObject({ id: RESTORE_ID, with: restoreWith });
    expect(save).toMatchObject({ if: SAVE_IF, with: { path: ASSET_DIR, key: SAVE_KEY } });
  });

  it('[ICW-4] the action installs through install.sh with the token and asset dir', () => {
    const install = stepWithRole('install');
    expect(install.id).toBe(INSTALL_ID);
    expect(install.run).toBe(`bash "\${GITHUB_WORKSPACE}/${SCRIPT_REL}"`);
    expect(install.env).toEqual({ GH_TOKEN: TOKEN_INPUT, CAMOUFOX_ASSET_DIR: ASSET_DIR });
  });

  it('[ICW-8] no step caches the install dir, which install.sh never trusts', () => {
    const defaultDir = scriptDefaultDir();
    const paths = actionSteps().map(step => step.with?.path ?? '');
    expect(defaultDir).not.toBe('');
    expect(paths).not.toContain(defaultDir);
  });

  it('[ICW-5] the Docker image copies what install.sh reads, then runs it', () => {
    const instructions = finalDockerStage();
    const camoufoxRuns = instructions.filter(line => /^RUN .*camoufox/iu.test(line));
    const positions = DOCKER_INSTALL.map(line => instructions.indexOf(line));
    const sorted = [...positions].sort((a, b) => a - b);
    expect(instructions[0]).toMatch(FROM_RE);
    expect(positions).not.toContain(-1);
    expect(positions).toEqual(sorted);
    expect(camoufoxRuns).toEqual([`RUN bash ${SCRIPT_REL}`]);
  });

  it('[ICW-7] the Docker image installs tokenless and carries no GitHub CLI', () => {
    const ghLines = finalDockerStage().filter(line => GH_PATH_RE.test(line));
    expect(ghLines).toEqual([]);
  });

  it.each(DOWNLOADERS)('[ICW-9] every curl in %s bounds its time', rel => {
    const calls = curlCalls(rel);
    const unbounded = calls.filter(call => !CURL_TIME_BOUNDS.every(flag => call.includes(flag)));
    expect(calls.length).toBeGreaterThan(0);
    expect(unbounded).toEqual([]);
  });

  it.each(CONSUMERS)('[ICW-6] %s never spells the pinned tag or digest', rel => {
    const { tag, linuxX64Sha256 } = pinnedCamoufox();
    const version = tag.replace(/^v/u, '');
    const text = readRepoFile(rel);
    expect(version).not.toBe('');
    expect(linuxX64Sha256).not.toBe('');
    expect(text).not.toContain(version);
    expect(text).not.toContain(linuxX64Sha256);
  });
});
