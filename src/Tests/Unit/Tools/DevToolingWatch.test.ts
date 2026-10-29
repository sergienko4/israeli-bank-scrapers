/**
 * Unit tests for the daily dev-tooling watch (`scripts/dev-tooling/watch.mjs`).
 *
 * <p>The watch reads three files and runs `npm` and every gate through one
 * `run` function. Here the files are fixed texts behind a fake `readFile`,
 * and `run` is a fake that records each command line and its timeout, moves
 * a fake clock on, and answers from the scenario: published versions for
 * `npm view`, the installed tree for `npm ls`, and exit 1 for any command
 * line the scenario fails. So each case pins one part of the contract: which
 * packages are candidates, the exact install, which gates run, the time each
 * gets, the verdict, and exit 2 when an input cannot be read. One case runs
 * the real `runCommand`, to pin that a timed-out command is killed for sure.
 */

import {
  matchesPattern,
  matchingPackages,
  toolingPatterns,
} from '../../../../scripts/dev-tooling/tooling-group.mjs';
import type { IRunResult } from '../../../../scripts/dev-tooling/watch.mjs';
import { GATES, runCommand, runWatch } from '../../../../scripts/dev-tooling/watch.mjs';
import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import { type IPrinted, printingIo } from '../../Helpers/BrowserStackWatchFixtures.js';
import { readRepoFile, trackedFiles } from '../../Helpers/RepoFiles.js';

const DEPENDABOT_PATH = '/repo/.github/dependabot.yml';
const PACKAGE_PATH = '/repo/package.json';
const LOCK_PATH = '/repo/package-lock.json';
const OUT_PATH = '/out/report.md';
const VERDICT_PATH = '/out/verdict.json';
const REPORT_ARGS = ['--out', OUT_PATH, '--verdict', VERDICT_PATH];
/** The date of the shared fixture clock. */
const CHECKED_ON = '2026-05-04';

/** A root npm entry whose `lint-tooling` group takes ESLint and its plugins. */
const DEPENDABOT = [
  'version: 2',
  'updates:',
  '  - package-ecosystem: npm',
  "    directory: '/'",
  '    groups:',
  '      lint-tooling:',
  "        patterns: [eslint, 'eslint-*', typescript-eslint]",
].join('\n');

/** The same file without the group. */
const DEPENDABOT_WITHOUT_GROUP = 'version: 2\nupdates: []\n';

/** Locked versions: three tooling packages and one the group does not take. */
const LOCKED: Readonly<Record<string, string>> = {
  eslint: '10.1.0',
  'eslint-plugin-x': '1.0.0',
  'typescript-eslint': '8.71.2',
  jest: '29.0.0',
};

/**
 * Published versions. `npm view --json` prints a bare string for a package
 * with a single version; prereleases and the next major must be skipped.
 */
const PUBLISHED: Readonly<Record<string, string | readonly string[]>> = {
  eslint: ['10.0.0', '10.1.0', '10.2.0', '10.10.0-rc.1', '11.0.0'],
  'eslint-plugin-x': '1.0.0',
  'typescript-eslint': ['8.9.0', '8.71.2', '8.72.0', '8.72.2-alpha.3', '9.0.0'],
};

/** What the watch installs from the default scenario. */
const CANDIDATES = [
  { name: 'eslint', from: '10.1.0', to: '10.2.0' },
  { name: 'typescript-eslint', from: '8.71.2', to: '8.72.0' },
];

const INSTALL_LINE =
  'npm install --no-save --ignore-scripts --no-audit --no-fund eslint@10.2.0 typescript-eslint@8.72.0';

/** How many output lines a failing command prints in the scenarios. */
const FAILURE_LINES = 40;

/** What a failing command prints: numbered lines, so the tail is checkable. */
const FAILURE_OUTPUT = Array.from({ length: FAILURE_LINES }, (_, i) => `line ${String(i + 1)}`);

/** A minute, in milliseconds. */
const MINUTE_MS = 60_000;

/** Why the watch did not run a command it had no time left for. */
const NOT_STARTED = 'not started: the probe used up its time budget';

/** What one scenario changes from the default state. */
interface IScenario {
  readonly dependabot?: string;
  readonly locked?: Readonly<Record<string, string>>;
  /** Packages package.json lists but the lockfile does not. */
  readonly unlocked?: readonly string[];
  /** Command lines, or their leading words, that exit 1. */
  readonly failing?: readonly string[];
  /** Command lines, or their leading words, that time out. */
  readonly timingOut?: readonly string[];
  /** What `npm ls` reports as installed; the candidates' `to` by default. */
  readonly installed?: Readonly<Record<string, string>>;
  /** Minutes each command takes on the fake clock; none by default. */
  readonly minutesPerCommand?: number;
}

/** A package and its version, as a lockfile or `npm ls` keys it. */
type LockEntry = [string, { readonly version: string }];

/** The watch's `run`: a command, its arguments and the milliseconds it gets. */
type Run = (command: string, args: readonly string[], timeoutMs: number) => IRunResult;

/** What the fake `run` saw, and the time it let pass. */
interface ICommandLog {
  readonly calls: string[];
  readonly timeoutsMs: number[];
  elapsedMs: number;
}

/** What one run returned, printed, wrote and ran. */
interface IRun {
  readonly exit: 0 | 2;
  readonly out: string;
  readonly err: string;
  readonly written: Readonly<Record<string, string>>;
  readonly calls: readonly string[];
  /** The timeout each command got, in call order. */
  readonly timeoutsMs: readonly number[];
}

/** The parts of the verdict file the tests read. */
interface IVerdictFile {
  readonly verdict: string;
  readonly checkedOn: string;
  readonly candidates: readonly object[];
  readonly gates: readonly object[];
  readonly errors: readonly string[];
}

/**
 * The command line of a gate, as the fake `run` records it.
 *
 * @param gate - The gate.
 * @param gate.command - Executable.
 * @param gate.args - Its arguments.
 * @returns `command args…`.
 */
function gateLine(gate: { readonly command: string; readonly args: readonly string[] }): string {
  return [gate.command, ...gate.args].join(' ');
}

const GATE_LINES = GATES.map(gateLine);

/**
 * package.json and package-lock.json for some locked versions.
 *
 * @param locked - Package → locked version.
 * @param unlocked - Packages to leave out of the lockfile.
 * @returns Path → text.
 */
function manifests(
  locked: Readonly<Record<string, string>>,
  unlocked: readonly string[],
): Record<string, string> {
  const entries = Object.entries(locked);
  const ranges = entries.map(([name, v]): [string, string] => [name, `^${v}`]);
  const devDependencies = Object.fromEntries(ranges);
  const lockEntries = entries.filter(([name]) => !unlocked.includes(name));
  const lockedPaths = lockEntries.map(([n, v]): LockEntry => [`node_modules/${n}`, { version: v }]);
  const packages = Object.fromEntries(lockedPaths);
  const packageText = JSON.stringify({ devDependencies });
  const lockText = JSON.stringify({ packages: { '': {}, ...packages } });
  return { [PACKAGE_PATH]: packageText, [LOCK_PATH]: lockText };
}

/**
 * A fake `readFile` over the scenario's files.
 *
 * @param scenario - The scenario.
 * @returns Reads a file, or throws like a missing one.
 */
function fakeReadFile(scenario: IScenario): (path: string) => string {
  const locked = scenario.locked ?? LOCKED;
  const manifestFiles = manifests(locked, scenario.unlocked ?? []);
  const manifestEntries = Object.entries(manifestFiles);
  const files = new Map([[DEPENDABOT_PATH, scenario.dependabot ?? DEPENDABOT], ...manifestEntries]);
  return (path: string): string => {
    const text = files.get(path);
    if (text !== undefined) return text;
    throw new ScraperError(`ENOENT ${path}`);
  };
}

/**
 * What `npm ls --json` prints for the scenario.
 *
 * @param scenario - The scenario.
 * @returns Its stdout.
 */
function lsOutput(scenario: IScenario): string {
  const askedEntries = CANDIDATES.map((c): [string, string] => [c.name, c.to]);
  const asked = Object.fromEntries(askedEntries);
  const installed = Object.entries(scenario.installed ?? asked);
  const versions = installed.map(([name, version]): LockEntry => [name, { version }]);
  const dependencies = Object.fromEntries(versions);
  return JSON.stringify({ dependencies });
}

/**
 * The answer to a command that does not fail.
 *
 * @param scenario - The scenario.
 * @param args - The npm or gate arguments.
 * @returns Its result.
 */
function answer(scenario: IScenario, args: readonly string[]): IRunResult {
  const replies: Record<string, () => IRunResult> = {
    /**
     * `npm view <name> versions --json`.
     *
     * @returns The published versions of the package.
     */
    view: () => ({ status: 0, stdout: JSON.stringify(PUBLISHED[args[1]]), stderr: '' }),
    /**
     * `npm ls --json`, which exits 0: same-major releases satisfy the caret ranges.
     *
     * @returns The installed tree.
     */
    ls: () => ({ status: 0, stdout: lsOutput(scenario), stderr: '' }),
  };
  const reply = replies[args[0]] as (() => IRunResult) | undefined;
  return reply ? reply() : { status: 0, stdout: '', stderr: '' };
}

/** What a failing command returns. */
const FAILURE: IRunResult = { status: 1, stdout: FAILURE_OUTPUT.join('\n'), stderr: '' };

/** What `runCommand` returns for a command it killed at its timeout. */
const TIMED_OUT: IRunResult = {
  status: 1,
  stdout: '',
  stderr: 'spawnSync npx ETIMEDOUT\n',
  unfinished: 'spawnSync npx ETIMEDOUT',
};

/**
 * Whether a command line is one of the listed lines, or starts with one's words.
 *
 * @param listed - Command lines or leading words.
 * @param line - The command line.
 * @returns True when listed.
 */
function isListed(listed: readonly string[], line: string): boolean {
  return listed.some(words => `${line} `.startsWith(`${words} `));
}

/**
 * A fake `run` that logs every command line and its timeout, moves the clock
 * on, and answers from the scenario.
 *
 * @param scenario - The scenario.
 * @param log - Where the command lines, timeouts and elapsed time go.
 * @returns The fake.
 */
function fakeRun(scenario: IScenario, log: ICommandLog): Run {
  return (command: string, args: readonly string[], timeoutMs: number): IRunResult => {
    const line = [command, ...args].join(' ');
    log.calls.push(line);
    log.timeoutsMs.push(timeoutMs);
    log.elapsedMs += (scenario.minutesPerCommand ?? 0) * MINUTE_MS;
    if (isListed(scenario.timingOut ?? [], line)) return TIMED_OUT;
    if (isListed(scenario.failing ?? [], line)) return FAILURE;
    return answer(scenario, args);
  };
}

/**
 * A clock that starts at `start` and moves on as the fake `run` lets time pass.
 *
 * @param start - The time of the first reading.
 * @param log - Holds the elapsed time.
 * @returns The clock.
 */
function fakeNow(start: Date, log: ICommandLog): () => Date {
  const startMs = start.getTime();
  return (): Date => new Date(startMs + log.elapsedMs);
}

/**
 * Run the watch once on a scenario.
 *
 * @param scenario - What differs from the default state.
 * @param args - CLI arguments.
 * @returns What it returned, printed, wrote and ran.
 */
function watch(scenario: IScenario = {}, args: readonly string[] = REPORT_ARGS): IRun {
  const printed: IPrinted = { out: '', err: '', written: {} };
  const log: ICommandLog = { calls: [], timeoutsMs: [], elapsedMs: 0 };
  const readFile = fakeReadFile(scenario);
  const run = fakeRun(scenario, log);
  const output = printingIo(printed);
  const start = output.now();
  const now = fakeNow(start, log);
  const paths = { dependabotPath: DEPENDABOT_PATH, packagePath: PACKAGE_PATH, lockPath: LOCK_PATH };
  const exit = runWatch(args, { ...paths, readFile, run, ...output, now });
  return { exit, ...printed, calls: log.calls, timeoutsMs: log.timeoutsMs };
}

/**
 * The verdict file a run wrote.
 *
 * @param run - The run.
 * @returns It, parsed.
 */
function verdictOf(run: IRun): IVerdictFile {
  return JSON.parse(run.written[VERDICT_PATH]) as IVerdictFile;
}

/**
 * The command lines a run made that start with a prefix.
 *
 * @param run - The run.
 * @param prefix - The prefix.
 * @returns Those lines, in order.
 */
function callsStarting(run: IRun, prefix: string): readonly string[] {
  return run.calls.filter(line => line.startsWith(prefix));
}

/**
 * The gates a run ran.
 *
 * @param run - The run.
 * @returns Their command lines, in order.
 */
function gatesRun(run: IRun): readonly string[] {
  return run.calls.filter(line => GATE_LINES.includes(line));
}

/** Each gate's name and command line, for the per-gate cases. */
const GATE_CASES = GATES.map((gate): [string, string] => [gate.name, gateLine(gate)]);

/** Every gate, passed. */
const ALL_PASSED = GATES.map(gate => ({ name: gate.name, passed: true }));

/** Locked versions already on the newest same-major release. */
const UP_TO_DATE = { ...LOCKED, eslint: '10.2.0', 'typescript-eslint': '8.72.0' };

/** A script that runs one file: `npx tsx <file>` or `node <file>`. */
const SCRIPT_ENTRY = /(?:npx tsx|node) (\S+\.(?:ts|mjs|cjs))/u;

/** The specifier of a static or dynamic import. */
const IMPORT_SPECIFIER = /(?:from|import)\s*(?:\(\s*)?'([^']+)'/gu;

/**
 * The package a bare import specifier names.
 *
 * @param specifier - `name`, `name/sub`, `@scope/name` or `@scope/name/sub`.
 * @returns `name` or `@scope/name`.
 */
function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  const length = specifier.startsWith('@') ? 2 : 1;
  return parts.slice(0, length).join('/');
}

/**
 * Whether a script's entry file, if it is tracked, imports a lint-tooling package.
 *
 * @param command - The script's command line.
 * @param tracked - The files git tracks.
 * @param patterns - The `lint-tooling` group's patterns.
 * @returns True when it does.
 */
function importsTooling(
  command: string,
  tracked: ReadonlySet<string>,
  patterns: readonly string[],
): boolean {
  const entry = SCRIPT_ENTRY.exec(command)?.[1];
  if (entry === undefined || !tracked.has(entry)) return false;
  const source = readRepoFile(entry);
  const imports = source.matchAll(IMPORT_SPECIFIER);
  const bare = Array.from(imports, match => match[1]).filter(s => !/^(?:\.|node:)/u.test(s));
  const packages = bare.map(packageOf);
  return matchingPackages(packages, patterns).length > 0;
}

/**
 * The package.json scripts whose entry file imports a lint-tooling package.
 *
 * @returns Their names.
 */
function lintToolingScripts(): readonly string[] {
  const dependabot = readRepoFile('.github/dependabot.yml');
  const patterns = toolingPatterns(dependabot);
  const tracked = new Set(trackedFiles());
  const manifest = readRepoFile('package.json');
  const { scripts } = JSON.parse(manifest) as { readonly scripts: Record<string, string> };
  const entries = Object.entries(scripts);
  const loading = entries.filter(([, command]) => importsTooling(command, tracked, patterns));
  return loading.map(([name]) => name);
}

/**
 * A command that ignores SIGTERM and starts a child that inherits its pipes;
 * both exit after 5 s. If `runCommand` sends SIGTERM, or waits for the pipes
 * to close, the case outlasts its bound and fails rather than hanging Jest.
 */
const IGNORES_SIGTERM = [
  "process.on('SIGTERM', () => {});",
  "const holder = ['-e', 'setTimeout(() => {}, 5000)'];",
  "require('node:child_process').spawn(process.execPath, holder, { stdio: 'inherit' });",
  'setTimeout(() => {}, 5000);',
].join(' ');

/** How long DTW-16 gives the command before `runCommand` kills it. */
const KILL_AFTER_MS = 300;

/** The most DTW-16 lets `runCommand` take: well under the command's 5 s. */
const RETURNS_WITHIN_MS = 4000;

describe('dev-tooling watch', () => {
  it('[DTW-1] installs the newest same-major stable release of each tooling package', () => {
    const run = watch();
    const installs = callsStarting(run, 'npm install');
    expect(installs).toEqual([INSTALL_LINE]);
    const verdict = verdictOf(run);
    expect(verdict.candidates).toEqual(CANDIDATES);
  });

  it('[DTW-2] asks the registry about the lint-tooling packages only', () => {
    const run = watch();
    const views = callsStarting(run, 'npm view');
    const asked = views.map(line => line.split(' ')[2]);
    expect(asked).toEqual(['eslint', 'eslint-plugin-x', 'typescript-eslint']);
  });

  it('[DTW-3] passes after running every gate, in order, on the installed candidates', () => {
    const run = watch();
    expect(run.exit).toBe(0);
    const ran = gatesRun(run);
    expect(ran).toEqual(GATE_LINES);
    const lsAt = run.calls.findIndex(line => line.startsWith('npm ls'));
    const firstGateAt = run.calls.indexOf(GATE_LINES[0]);
    expect(lsAt).toBeLessThan(firstGateAt);
    const expected = { verdict: 'pass', checkedOn: CHECKED_ON, candidates: CANDIDATES };
    const verdict = verdictOf(run);
    expect(verdict).toEqual({ ...expected, gates: ALL_PASSED, errors: [] });
  });

  it('[DTW-4] prints the report and writes the same text to --out', () => {
    const run = watch();
    expect(run.written[OUT_PATH]).toBe(run.out);
    expect(run.out).toContain('## Dev-tooling watch');
    expect(run.out).toContain('Checked 2026-05-04.');
    expect(run.out).toContain('| `eslint` | `10.1.0` | `10.2.0` |');
    expect(run.out).toContain('**pass**');
  });

  it.each(GATE_CASES)(
    '[DTW-5] fails when %s fails, still runs every gate, and reports its tail',
    (name, line) => {
      const run = watch({ failing: [line] });
      const verdict = verdictOf(run);
      expect(verdict.verdict).toBe('fail');
      const failed = GATES.map(gate => ({ name: gate.name, passed: gate.name !== name }));
      expect(verdict.gates).toEqual(failed);
      const ran = gatesRun(run);
      expect(ran).toEqual(GATE_LINES);
      expect(run.out).toContain(`#### ${name}`);
      expect(run.out).toContain(`line ${String(FAILURE_LINES)}`);
      expect(run.out).toContain('\nline 11\n');
      expect(run.out).not.toContain('\nline 10\n');
    },
  );

  it('[DTW-6] installs nothing and runs no gate when every package is on its newest release', () => {
    const run = watch({ locked: UP_TO_DATE });
    expect(run.exit).toBe(0);
    const verdict = verdictOf(run);
    expect(verdict).toMatchObject({ verdict: 'no-candidate', candidates: [], gates: [] });
    const npmCalls = run.calls.filter(line => !line.startsWith('npm view'));
    expect(npmCalls).toEqual([]);
    expect(run.out).toContain('**no candidate**');
  });

  it('[DTW-7] reports an error and runs no gate when the install fails', () => {
    const run = watch({ failing: ['npm install'] });
    const verdict = verdictOf(run);
    expect(verdict).toMatchObject({ verdict: 'error', gates: [] });
    expect(verdict.errors[0]).toMatch(/^npm install exited 1:\n/);
    const ran = gatesRun(run);
    expect(ran).toEqual([]);
    expect(run.out).toContain('### Errors');
  });

  it('[DTW-8] reports an error and runs no gate when npm ls shows another version', () => {
    const installed = { eslint: '10.1.0', 'typescript-eslint': '8.72.0' };
    const run = watch({ installed });
    const verdict = verdictOf(run);
    expect(verdict.verdict).toBe('error');
    expect(verdict.errors).toEqual(['npm ls: eslint is 10.1.0, not 10.2.0']);
    const ran = gatesRun(run);
    expect(ran).toEqual([]);
  });

  it('[DTW-12] reports an error, not a failure, when a gate times out, and still runs the rest', () => {
    const run = watch({ timingOut: [GATE_LINES[0]] });
    expect(run.exit).toBe(0);
    const verdict = verdictOf(run);
    expect(verdict.verdict).toBe('error');
    expect(verdict.errors).toEqual([`${GATES[0].name} did not finish: spawnSync npx ETIMEDOUT`]);
    const ran = gatesRun(run);
    expect(ran).toEqual(GATE_LINES);
    expect(run.out).toContain('**error**');
  });

  it('[DTW-13] gives each command what is left of 30 minutes, and starts none after that', () => {
    const run = watch({ minutesPerCommand: 4 });
    const minutes = run.timeoutsMs.map(ms => ms / MINUTE_MS);
    expect(minutes).toEqual([10, 10, 10, 10, 10, 10, 6, 2]);
    const ran = gatesRun(run);
    const firstThree = GATE_LINES.slice(0, 3);
    expect(ran).toEqual(firstThree);
    const verdict = verdictOf(run);
    expect(verdict.verdict).toBe('error');
    const notStarted = GATES.slice(3).map(gate => `${gate.name} did not finish: ${NOT_STARTED}`);
    expect(verdict.errors).toEqual(notStarted);
  });

  it.each<[string, IScenario, string]>([
    ['fails', { failing: ['npm ls'] }, `line ${String(FAILURE_LINES)}`],
    ['times out', { timingOut: ['npm ls'] }, 'ETIMEDOUT'],
  ])('[DTW-14] reports an error and runs no gate when npm ls %s', (_, scenario, tail) => {
    const run = watch(scenario);
    const verdict = verdictOf(run);
    expect(verdict).toMatchObject({ verdict: 'error', gates: [] });
    expect(verdict.errors).toHaveLength(1);
    expect(verdict.errors[0]).toMatch(/^npm ls exited 1:\n/);
    expect(verdict.errors[0]).toContain(tail);
    const ran = gatesRun(run);
    expect(ran).toEqual([]);
  });

  it('[DTW-15] runs every package.json script that imports a lint-tooling package', () => {
    const scripts = lintToolingScripts();
    expect(scripts).toContain('lint:guideline-coverage');
    const ungated = scripts.filter(name => !GATE_LINES.includes(`npm run ${name}`));
    expect(ungated).toEqual([]);
  });

  it('[DTW-16] kills a timed-out command that ignores SIGTERM and has a child', () => {
    const started = Date.now();
    const result = runCommand(process.execPath, ['-e', IGNORES_SIGTERM], KILL_AFTER_MS);
    const elapsed = Date.now() - started;
    expect(result.unfinished).toMatch(/ETIMEDOUT/u);
    expect(result.status).toBe(1);
    expect(elapsed).toBeLessThan(RETURNS_WITHIN_MS);
  });

  it.each<[string, IScenario, readonly string[]]>([
    ['REGISTRY-FAILED', { failing: ['npm view typescript-eslint'] }, REPORT_ARGS],
    ['CONFIG-INVALID', { dependabot: DEPENDABOT_WITHOUT_GROUP }, REPORT_ARGS],
    ['CONFIG-INVALID', { dependabot: 'updates: [' }, REPORT_ARGS],
    ['LOCK-INVALID', { unlocked: ['typescript-eslint'] }, REPORT_ARGS],
    ['USAGE', {}, ['--bogus']],
  ])('[DTW-9] exits 2 with %s and writes nothing', (label, scenario, args) => {
    const run = watch(scenario, args);
    expect(run.exit).toBe(2);
    expect(run.err).toMatch(new RegExp(`^${label} `, 'u'));
    expect(run.written).toEqual({});
    expect(run.out).toBe('');
    const installs = callsStarting(run, 'npm install');
    expect(installs).toEqual([]);
  });

  it.each(GATE_LINES)('[DTW-10] runs `%s` as CI or the pre-commit hook does', line => {
    const workflow = readRepoFile('.github/workflows/pr.yml');
    const hook = readRepoFile('.husky/pre-commit');
    const commands = `${workflow}\n${hook}`.replaceAll(/["']/g, '');
    expect(commands).toContain(line);
  });

  it.each<[string, string, boolean]>([
    ['eslint', 'eslint', true],
    ['eslint', 'eslint-plugin-x', false],
    ['eslint-*', 'eslint-plugin-x', true],
    ['eslint-*', 'eslint', false],
    ['@eslint/*', '@eslint/js', true],
    ['@typescript-eslint/*', 'typescript-eslint', false],
    ['@biomejs/biome', '@biomejs/biome', true],
    ['a.b', 'axb', false],
  ])('[DTW-11] pattern %s matches %s: %s', (pattern, name, expected) => {
    const isMatch = matchesPattern(pattern, name);
    expect(isMatch).toBe(expected);
  });
});
