/**
 * Install-camoufox wiring.
 *
 * <p>`InstallCamoufoxScript` proves what `install.sh` does; this suite pins
 * that both of its consumers still run it and that the CI cache follows the
 * manifest. The composite action must resolve the tag and asset digest
 * through the manifest validator, key the cache on both outputs, cache the
 * directory `install.sh` installs to by default, and run `install.sh` with
 * the token. The Docker CI mirror must copy what `install.sh` reads and run
 * it as its only Camoufox install. No consumer may spell the pinned tag or
 * digest: a literal there would survive a manifest bump, so a static cache
 * key would keep restoring the old build, or Docker would install a
 * different one from CI.
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
const CACHE_ACTION = 'actions/cache@';
const RESOLVED = `steps.${RESOLVE_ID}.outputs`;
const CACHE_KEY = `camoufox-bin-\${{ ${RESOLVED}.tag }}-\${{ ${RESOLVED}.sha256 }}`;
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
const DEFAULT_DIR_RE = /CACHE_DIR="\$\{CAMOUFOX_INSTALL_DIR:-\$HOME\/(?<dir>[^}"]+)\}"/u;
/** A Dockerfile line continuation plus the next line's indent. */
const CONTINUATION_RE = /\\\n\s*/gu;
/** A Dockerfile instruction that starts a build stage. */
const FROM_RE = /^FROM\s/iu;

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

/** One step of the composite. */
interface IStep {
  readonly id?: string;
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
  ['cache', 'uses', CACHE_ACTION],
  ['install', 'run', SCRIPT_REL],
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
 * @returns `resolve`, `cache` or `install`; `other` for anything else.
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
  it('[ICW-1] the action resolves the tag, then caches, then installs', () => {
    const roles = actionSteps().map(roleOf);
    expect(roles).toEqual(['resolve', 'cache', 'install']);
  });

  it('[ICW-2] the step the cache key reads exports the validated tag and digest', () => {
    const resolve = stepWithRole('resolve');
    expect(resolve).toMatchObject({ id: RESOLVE_ID, shell: 'bash', run: RESOLVE_RUN });
  });

  it('[ICW-3] the cache is keyed on both and holds install.sh default directory', () => {
    const cache = stepWithRole('cache');
    const defaultDir = scriptDefaultDir();
    expect(cache.with?.key).toBe(CACHE_KEY);
    expect(defaultDir).not.toBe('');
    expect(cache.with?.path).toBe(defaultDir);
  });

  it('[ICW-4] the action installs through install.sh with the token', () => {
    const install = stepWithRole('install');
    expect(install.run).toBe(`bash "\${GITHUB_WORKSPACE}/${SCRIPT_REL}"`);
    expect(install.env).toEqual({ GH_TOKEN: TOKEN_INPUT });
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
