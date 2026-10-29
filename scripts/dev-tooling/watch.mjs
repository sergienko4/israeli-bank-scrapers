/**
 * Daily dev-tooling watch: would the next `lint-tooling` update go green?
 *
 * Dependabot bumps the lint tooling in one grouped PR (`.github/dependabot.yml`).
 * A new release can add a rule that fails code which was clean the day
 * before, and the PR stays red until someone changes that code. The watch
 * runs the same check before the PR exists: it installs the newest
 * same-major release of each `lint-tooling` devDependency into
 * `node_modules` — `package.json` and the lockfile stay as they are — and
 * runs the static gates that PR must pass. A failure shows up early, the fix
 * lands on `main` first, and the update is green when it arrives.
 *
 * The result is a markdown report (see watch-report.mjs), printed and
 * optionally written to `--out <file>`, and a JSON verdict written to
 * `--verdict <file>`.
 *
 * Exit codes: 0 verdict written, whatever it is · 2 the watch cannot read its
 * inputs (USAGE, CONFIG-INVALID, PACKAGE-INVALID, LOCK-INVALID,
 * REGISTRY-FAILED). Candidates that fail to install, and a gate that times
 * out, is killed or is left no time, are the verdict `error`, not exit 2.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { matchingPackages, TOOLING_GROUP, toolingPatterns } from './tooling-group.mjs';
import { renderWatch } from './watch-report.mjs';

/**
 * @typedef {import('./watch.d.mts').IDevToolingWatchIo} IDevToolingWatchIo
 * @typedef {import('./watch.d.mts').IRunResult} IRunResult
 * @typedef {Required<IDevToolingWatchIo>} RawIo - Watch I/O, defaults filled in.
 * @typedef {(command: string, args: readonly string[]) => IRunResult} BudgetedRun - Runs a command on the probe's budget.
 * @typedef {Omit<RawIo, 'run'> & { run: BudgetedRun }} WatchIo - Watch I/O, its `run` on the budget.
 * @typedef {import('./watch-report.mjs').Candidate} Candidate
 * @typedef {import('./watch-report.mjs').GateResult} GateResult
 * @typedef {import('./watch-report.mjs').Watch} Watch
 * @typedef {Pick<Watch, 'verdict' | 'gates' | 'errors'>} Probe - What installing and gating found.
 * @typedef {{ name: string, from: string }} Locked - A tooling package and its locked version.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** How many lines of a failing command's output the report keeps. */
const TAIL_LINES = 30;

/** Room for the output of a gate over the whole tree. */
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * A command still running after this is killed and did not finish. ESLint,
 * the slowest gate, takes about a minute on a GitHub runner.
 */
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Every command of one run shares this; a command gets what is left, and none
 * starts once it is spent. The probe job's `timeout-minutes` must cover it plus
 * setup, or the job is killed before it writes a verdict;
 * DevToolingWatchWiring.test.ts checks that.
 */
export const PROBE_BUDGET_MS = 30 * 60 * 1000;

/** Why a command the budget left no time for did not run. */
const OUT_OF_TIME = 'not started: the probe used up its time budget';

/** A stable release: no prerelease or build suffix. */
const STABLE = /^\d+\.\d+\.\d+$/u;

/** `npm install` that changes `node_modules` only and runs no install script. */
const INSTALL = Object.freeze([
  'install',
  '--no-save',
  '--ignore-scripts',
  '--no-audit',
  '--no-fund',
]);

/**
 * The static gates the grouped update must pass, in run order: the
 * static-checks gates in pr.yml the lint tooling feeds, then the pre-commit
 * gates that load it: Biome and guideline coverage, which resolves the ESLint
 * config. DevToolingWatch.test.ts checks that each command is one CI or the
 * hook runs, and that every lint script loading a lint-tooling package is here.
 */
export const GATES = Object.freeze(
  /** @type {const} */ ([
    ['ESLint', 'npx', ['eslint', 'src', '--max-warnings', '0', '--ignore-pattern', '**/*.cjs']],
    ['Restricted-syntax guardrails', 'npm', ['run', 'lint:syntax-guardrails']],
    ['Architectural canaries', 'npm', ['run', 'lint:canaries']],
    ['Prettier', 'npx', ['prettier', '--check', 'src/**/*.{ts,tsx,js,jsx,json,md}']],
    ['Type check', 'npm', ['run', 'type-check']],
    ['Type check (TS 6)', 'npm', ['run', 'type-check:ts6']],
    ['Biome', 'npx', ['biome', 'lint', 'src', '--max-diagnostics=50']],
    ['Guideline coverage', 'npm', ['run', 'lint:guideline-coverage']],
  ]).map(([name, command, args]) => Object.freeze({ name, command, args })),
);

/**
 * Run a command in the repository root; a non-zero exit is a result, not a throw.
 *
 * @param {string} command - Executable.
 * @param {readonly string[]} args - Its arguments.
 * @param {number} timeout - Milliseconds before it is killed.
 * @returns {IRunResult} Exit status (1 when it did not finish), output, and why it did not finish.
 */
function runCommand(command, args, timeout) {
  const encoding = /** @type {const} */ ('utf8');
  const options = { cwd: ROOT, encoding, maxBuffer: MAX_BUFFER, timeout };
  const result = spawnSync(command, [...args], options);
  const killed = result.signal === null ? undefined : `killed by ${result.signal}`;
  const unfinished = result.error?.message ?? killed;
  const stderr = `${result.stderr ?? ''}${unfinished === undefined ? '' : `${unfinished}\n`}`;
  const output = { status: result.status ?? 1, stdout: result.stdout ?? '', stderr };
  return unfinished === undefined ? output : { ...output, unfinished };
}

/** Production I/O; tests override any member. */
const DEFAULT_IO = Object.freeze({
  dependabotPath: `${ROOT}.github/dependabot.yml`,
  packagePath: `${ROOT}package.json`,
  lockPath: `${ROOT}package-lock.json`,
  readFile: (/** @type {string} */ path) => readFileSync(path, 'utf8'),
  run: runCommand,
  now: () => new Date(),
  writeFile: (/** @type {string} */ path, /** @type {string} */ text) => writeFileSync(path, text),
  stdout: (/** @type {string} */ text) => process.stdout.write(text),
  stderr: (/** @type {string} */ text) => process.stderr.write(text),
});

/** The watch cannot read its inputs: exit 2, no verdict. */
class WatchInputError extends Error {
  /**
   * @param {string} label - USAGE, CONFIG-INVALID, PACKAGE-INVALID, LOCK-INVALID or REGISTRY-FAILED.
   * @param {string} detail - What went wrong.
   */
  constructor(label, detail) {
    super(`${label} ${detail}`);
    this.name = 'WatchInputError';
  }
}

/** @type {(error: unknown) => string} */
const messageOf = error => (error instanceof Error ? error.message : String(error));

/** @type {(result: IRunResult) => string} The last lines of a command's output. */
const tailOf = result =>
  `${result.stdout}${result.stderr}`.trimEnd().split('\n').slice(-TAIL_LINES).join('\n');

/** `--out` and `--verdict`, or USAGE. */
function parseWatchArgs(/** @type {readonly string[]} */ args) {
  const options = { out: { type: 'string' }, verdict: { type: 'string' } };
  try {
    return parseArgs({ args: [...args], options: /** @type {const} */ (options) }).values;
  } catch (error) {
    throw new WatchInputError('USAGE', messageOf(error));
  }
}

/**
 * Parse a file, or throw `label`.
 *
 * @template T
 * @param {WatchIo} io - Watch I/O.
 * @param {string} path - File path.
 * @param {string} label - The failure label.
 * @param {(text: string) => T} parse - The parser.
 * @returns {T} The parsed file.
 */
function readInput(io, path, label, parse) {
  try {
    return parse(io.readFile(path));
  } catch (error) {
    throw new WatchInputError(label, `${path}: ${messageOf(error)}`);
  }
}

/** The `lint-tooling` patterns, or CONFIG-INVALID. */
function groupPatterns(/** @type {WatchIo} */ io) {
  const patterns = readInput(io, io.dependabotPath, 'CONFIG-INVALID', toolingPatterns);
  if (patterns.length > 0) return patterns;
  const detail = `${io.dependabotPath}: no ${TOOLING_GROUP} group on the root npm entry`;
  throw new WatchInputError('CONFIG-INVALID', detail);
}

/**
 * The version the lockfile pins for a direct dependency, or LOCK-INVALID.
 *
 * @param {{ packages?: Record<string, { version?: unknown }> }} lock - package-lock.json.
 * @param {string} name - Package name.
 * @param {string} lockPath - For the error.
 * @returns {string} The locked version.
 */
function lockedVersion(lock, name, lockPath) {
  const version = lock.packages?.[`node_modules/${name}`]?.version;
  if (typeof version === 'string') return version;
  throw new WatchInputError('LOCK-INVALID', `${lockPath}: no locked version of ${name}`);
}

/**
 * The devDependencies the `lint-tooling` group takes, with their locked versions.
 *
 * @param {WatchIo} io - Watch I/O.
 * @returns {Locked[]} In package.json order.
 */
function lockedTooling(io) {
  const patterns = groupPatterns(io);
  const pkg = readInput(io, io.packagePath, 'PACKAGE-INVALID', JSON.parse);
  const lock = readInput(io, io.lockPath, 'LOCK-INVALID', JSON.parse);
  const names = matchingPackages(Object.keys(pkg.devDependencies ?? {}), patterns);
  return names.map(name => ({ name, from: lockedVersion(lock, name, io.lockPath) }));
}

/**
 * The versions `npm view --json` printed, or REGISTRY-FAILED.
 *
 * @param {string} name - Package name.
 * @param {string} stdout - Its output: an array, or a bare string for a single version.
 * @returns {unknown[]} The versions.
 */
function parseVersions(name, stdout) {
  try {
    return [JSON.parse(stdout)].flat();
  } catch (error) {
    throw new WatchInputError('REGISTRY-FAILED', `npm view ${name}: ${messageOf(error)}`);
  }
}

/**
 * Every published version of a package, or REGISTRY-FAILED.
 *
 * @param {WatchIo} io - Watch I/O.
 * @param {string} name - Package name.
 * @returns {string[]} The versions.
 */
function publishedVersions(io, name) {
  const result = io.run('npm', ['view', name, 'versions', '--json']);
  const failure = `npm view ${name} exited ${result.status}: ${tailOf(result)}`;
  if (result.status !== 0) throw new WatchInputError('REGISTRY-FAILED', failure);
  return parseVersions(name, result.stdout).filter(v => typeof v === 'string');
}

/** @type {(version: string) => number[]} */
const numbersOf = version => version.split('.').map(Number);

/** Whether stable version `a` is newer than stable version `b`. */
function isNewer(/** @type {string} */ a, /** @type {string} */ b) {
  const [x, y] = [numbersOf(a), numbersOf(b)];
  const at = x.findIndex((n, i) => n !== y[i]);
  return at !== -1 && x[at] > y[at];
}

/**
 * The newest stable version with the same major as `from`, or `from`.
 *
 * @param {readonly string[]} versions - Published versions.
 * @param {string} from - The locked version.
 * @returns {string} The newest same-major stable release.
 */
function newestSameMajor(versions, from) {
  const [major] = from.split('.');
  const sameMajor = versions.filter(v => STABLE.test(v) && v.split('.')[0] === major);
  return sameMajor.reduce((newest, v) => (isNewer(v, newest) ? v : newest), from);
}

/**
 * The tooling packages with a newer same-major release.
 *
 * @param {WatchIo} io - Watch I/O.
 * @param {readonly Locked[]} locked - The tooling packages.
 * @returns {Candidate[]} What the probe installs.
 */
function candidatesOf(io, locked) {
  const latest = locked.map(p => ({
    ...p,
    to: newestSameMajor(publishedVersions(io, p.name), p.from),
  }));
  return latest.filter(c => c.to !== c.from);
}

/**
 * The top-level packages `npm ls --json` printed, or `null` when it printed no JSON.
 *
 * @param {string} stdout - Its output.
 * @returns {Record<string, { version?: string }> | null} Package → what is installed.
 */
function lsTree(stdout) {
  try {
    return JSON.parse(stdout).dependencies ?? {};
  } catch {
    return null;
  }
}

/**
 * The candidates whose installed version is not the one asked for.
 *
 * Same-major releases satisfy the caret ranges in package.json, so `npm ls`
 * exits 0 after the install; anything else is a broken tree, or it did not
 * finish.
 *
 * @param {WatchIo} io - Watch I/O.
 * @param {readonly Candidate[]} candidates - What was installed.
 * @returns {string[]} One error per mismatch.
 */
function mismatches(io, candidates) {
  const result = io.run('npm', ['ls', '--json', '--depth=0', ...candidates.map(c => c.name)]);
  if (result.status !== 0) return [`npm ls exited ${result.status}:\n${tailOf(result)}`];
  const tree = lsTree(result.stdout);
  if (tree === null) return [`npm ls printed no JSON:\n${tailOf(result)}`];
  const wrong = candidates.filter(c => tree[c.name]?.version !== c.to);
  return wrong.map(c => `npm ls: ${c.name} is ${tree[c.name]?.version ?? 'missing'}, not ${c.to}`);
}

/**
 * Install the candidates; any error means no gate can run.
 *
 * @param {WatchIo} io - Watch I/O.
 * @param {readonly Candidate[]} candidates - What to install.
 * @returns {string[]} Why they are not installed; empty when they are.
 */
function install(io, candidates) {
  const result = io.run('npm', [...INSTALL, ...candidates.map(c => `${c.name}@${c.to}`)]);
  if (result.status !== 0) return [`npm install exited ${result.status}:\n${tailOf(result)}`];
  return mismatches(io, candidates);
}

/** @type {(io: WatchIo) => GateResult[]} Run every gate, whatever the ones before found. */
const runGates = io =>
  GATES.map(gate => {
    const result = io.run(gate.command, gate.args);
    const passed = result.status === 0;
    const gateResult = { name: gate.name, passed, tail: passed ? '' : tailOf(result) };
    const { unfinished } = result;
    return unfinished === undefined ? gateResult : { ...gateResult, unfinished };
  });

/** @type {(gates: readonly GateResult[]) => string[]} The gates that did not finish, and why. */
const unfinishedGates = gates =>
  gates.flatMap(g =>
    g.unfinished === undefined ? [] : [`${g.name} did not finish: ${g.unfinished}`],
  );

/**
 * Install the candidates and run the gates on them.
 *
 * @param {WatchIo} io - Watch I/O.
 * @param {readonly Candidate[]} candidates - What to install.
 * @returns {Probe} The verdict, gate results and errors.
 */
function probe(io, candidates) {
  if (candidates.length === 0) return { verdict: 'no-candidate', gates: [], errors: [] };
  const errors = install(io, candidates);
  if (errors.length > 0) return { verdict: 'error', gates: [], errors };
  const gates = runGates(io);
  const unfinished = unfinishedGates(gates);
  if (unfinished.length > 0) return { verdict: 'error', gates, errors: unfinished };
  return { verdict: gates.every(g => g.passed) ? 'pass' : 'fail', gates, errors: [] };
}

/** @type {(watch: Watch) => object} The verdict file: the watch without gate output. */
const verdictJson = watch => ({
  ...watch,
  gates: watch.gates.map(({ name, passed }) => ({ name, passed })),
});

/**
 * Print the report, write it to `--out` and the verdict to `--verdict` when given.
 *
 * @param {readonly string[]} args - CLI arguments after the script path.
 * @param {WatchIo} io - Watch I/O.
 * @returns {0} Exit code: the verdict is written, whatever it is.
 */
function writeReport(args, io) {
  const { out, verdict } = parseWatchArgs(args);
  const candidates = candidatesOf(io, lockedTooling(io));
  const checkedOn = io.now().toISOString().slice(0, 10);
  const watch = { checkedOn, candidates, ...probe(io, candidates) };
  const body = renderWatch(watch);
  io.stdout(body);
  if (out !== undefined) io.writeFile(out, body);
  if (verdict !== undefined)
    io.writeFile(verdict, `${JSON.stringify(verdictJson(watch), null, 2)}\n`);
  return 0;
}

/**
 * `io` whose `run` gives each command what is left of PROBE_BUDGET_MS, at most
 * COMMAND_TIMEOUT_MS, and starts none once the budget is spent.
 *
 * @param {RawIo} io - Watch I/O.
 * @returns {WatchIo} The same I/O, its `run` on the budget.
 */
function withBudget(io) {
  const deadline = io.now().getTime() + PROBE_BUDGET_MS;
  /** @type {BudgetedRun} */
  const run = (command, args) => {
    const left = deadline - io.now().getTime();
    if (left <= 0) {
      return { status: 1, stdout: '', stderr: `${OUT_OF_TIME}\n`, unfinished: OUT_OF_TIME };
    }
    return io.run(command, args, Math.min(COMMAND_TIMEOUT_MS, left));
  };
  return { ...io, run };
}

/**
 * Run the watch once.
 *
 * @param {readonly string[]} args - CLI arguments after the script path.
 * @param {IDevToolingWatchIo} [overrides] - Test I/O.
 * @returns {0 | 2} Exit code.
 * @throws {Error} Only on a bug: anything that is not an input failure.
 */
export function runWatch(args, overrides = {}) {
  const io = withBudget({ ...DEFAULT_IO, ...overrides });
  try {
    return writeReport(args, io);
  } catch (error) {
    if (!(error instanceof WatchInputError)) throw error;
    io.stderr(`${error.message}\n`);
    return 2;
  }
}
