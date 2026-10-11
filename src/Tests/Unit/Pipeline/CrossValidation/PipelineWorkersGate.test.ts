/**
 * Worker-count contract for `npm run test:pipeline`.
 *
 * <p>`test:pipeline` reads `jest.pipeline.suite.config.cjs`, which is the
 * shared `jest.pipeline.config.cjs` plus a `maxWorkers` a run can raise through
 * `JEST_MAX_WORKERS`. Each link fails silently when it breaks. A `--maxWorkers`
 * flag in the script beats the config and switches the knob off. A
 * `maxWorkers` in the shared config changes the Memory gate's workload. A value
 * Jest cannot parse becomes one worker. So this suite pins every link: the
 * script, the shared config, the resolved config, and CI's worker count.
 *
 * <p>CI stays on the default 2: a trial at 4 hit Jest's ESM "module not been
 * linked" race on the Node 22 leg (see the `unit-tests` job in `pr.yml`).
 *
 * <p>PWG-1 and PWG-5 read code, not lines. Each file is first reduced to what
 * actually runs: YAML is parsed, so comments vanish and folded scalars are
 * joined; shell drops whole-line comments and joins `\`-continued lines; JS is
 * reprinted without comments by the TypeScript printer. The result is split
 * into commands at shell separators. A command that runs the suite (the npm
 * script or the suite config directly) must be one of the known-safe runs:
 * `npm run test:pipeline`, bare or with `-- --coverage=false`. Any other
 * argument can move the worker count: a worker flag, a second `--config`, an
 * option that forces one worker, or a variable, substitution, expression,
 * `xargs` or `eval` that hides one. So the scan allows known runs instead of
 * hunting known flags; even a step name that mentions the suite must change.
 * JS cannot run the suite at all. A mention of the knob anywhere in that code
 * fails outright. PWG-6 pins the scanner against every spelling and hiding
 * place it must catch and every comment it must skip.
 *
 * Rules:
 *   PWG-1  `test:pipeline` passes Jest only allowed arguments; no npm script overrides it
 *   PWG-2  `test:memory` and the shared config stay free of a worker count
 *   PWG-3  the suite config is the shared config plus `JEST_MAX_WORKERS` (default 2)
 *   PWG-4  a value Jest would quietly turn into one worker fails the config load
 *   PWG-5  no CI code overrides the worker count, so CI runs the default 2
 *   PWG-6  the scanner catches every override spelling and indirection, and skips comments
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ts from 'typescript';
import { parse } from 'yaml';

const THIS_FILE_URL = import.meta.url;
const THIS_FILE_PATH = fileURLToPath(THIS_FILE_URL);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const PACKAGE_JSON = join(REPO_ROOT, 'package.json');
const BASE_CONFIG = 'jest.pipeline.config.cjs';
const SUITE_CONFIG = 'jest.pipeline.suite.config.cjs';
const KNOB = 'JEST_MAX_WORKERS';

/**
 * A Jest CLI flag that fixes the worker count and so overrides the config:
 * `--maxWorkers` / `--max-workers` / `-w` (with `=`, a space or attached
 * digits) or `--runInBand` / `--run-in-band` / `-i`. The boundaries admit a
 * quote, comma or bracket, so an argv array entry counts as well.
 */
const WORKER_FLAG =
  /(?:^|[\s'"`,[(])(?:--maxWorkers|--max-workers|-w\d*|--runInBand|--run-in-band|-i)(?=[\s=,'"`\])]|$)/;

/** A command that runs the suite: the npm script, or Jest on the suite config. */
const SUITE_RUN = /test:pipeline|jest\.pipeline\.suite\.config/;

/** The only suite runs CI code may contain, with runs of whitespace collapsed. */
const SAFE_SUITE_RUNS: ReadonlySet<string> = new Set([
  'npm run test:pipeline',
  'npm run test:pipeline -- --coverage=false',
]);

/** Each word `test:pipeline` itself may pass: none of them sets the worker count. */
const SUITE_SCRIPT_WORD =
  /^(?:node|--experimental-vm-modules|--expose-gc|node_modules\/jest\/bin\/jest\.js|--config=jest\.pipeline\.suite\.config\.cjs|--ci|--coverage|--testPathIgnorePatterns=[\w./-]+)$/;

/** File types whose argument flow a text scan cannot follow: no suite run there. */
const OPAQUE: ReadonlySet<string> = new Set(['.js', '.cjs', '.mjs']);

/** Shell command separators: a flag past one belongs to another command. */
const COMMAND_BREAK = /[\n;|&]/;

/** A whole-line shell comment; its newline stays, so it never joins two lines. */
const SHELL_COMMENT = /^[ \t]*#.*$/gm;

/** A backslash-newline, which the shell joins into one line. */
const CONTINUATION = /\\\r?\n/g;

/** Every place a CI job's environment or command line can come from. */
const CI_DIRS = ['.github/workflows', '.github/actions', '.github/scripts'] as const;

/** Loads both configs in a fresh process and reports how the suite one differs. */
const PROBE = [
  `const base = require('./${BASE_CONFIG}');`,
  `const { maxWorkers, ...rest } = require('./${SUITE_CONFIG}');`,
  'const sameAsBase = JSON.stringify(rest) === JSON.stringify(base);',
  "process.stdout.write(JSON.stringify({ maxWorkers, sameAsBase, baseHasWorkers: 'maxWorkers' in base }));",
].join('\n');

/** Leaves `JEST_MAX_WORKERS` out of the child's environment. */
const UNSET: Readonly<Record<string, string>> = {};

/** `[label, resolved maxWorkers, child env overrides]`. */
type AcceptedCase = readonly [string, string, Readonly<Record<string, string>>];

/** Unset falls back to 2; every accepted spelling passes through unchanged. */
const ACCEPTED: readonly AcceptedCase[] = [
  ['unset', '2', UNSET],
  ...['1', '4', '16', '50%', '100%'].map((value): AcceptedCase => [
    value,
    value,
    { [KNOB]: value },
  ]),
];

/** Values Jest's `parseWorkers` would turn into 1 worker or a surprise. */
const REJECTED = ['', 'four', '0', '-1', '0%', '101%', ' 4', '4.5'] as const;

/** What the probe printed. */
interface IProbe {
  readonly maxWorkers: string;
  readonly sameAsBase: boolean;
  readonly baseHasWorkers: boolean;
}

/** How one probe run ended. */
interface IProbeRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Every npm script in `package.json`.
 * @returns Script names mapped to their command lines.
 */
function npmScripts(): Readonly<Record<string, string>> {
  const text = readFileSync(PACKAGE_JSON, 'utf8');
  const pkg = JSON.parse(text) as { readonly scripts: Readonly<Record<string, string>> };
  return pkg.scripts;
}

/**
 * One npm script from `package.json`.
 * @param name - Script name.
 * @returns Its command line.
 */
function npmScript(name: string): string {
  const scripts = npmScripts();
  return scripts[name];
}

/**
 * The current environment without the knob, plus these overrides.
 * @param overrides - Variables to set; pass {@link UNSET} to leave the knob out.
 * @returns A copy of the current environment.
 */
function envWith(overrides: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const entries = Object.entries(process.env).filter(([key]): boolean => key !== KNOB);
  const inherited: NodeJS.ProcessEnv = Object.fromEntries(entries);
  return { ...inherited, ...overrides };
}

/**
 * Load both configs in a child Node process.
 * @param overrides - Variables to set; pass {@link UNSET} to leave the knob out.
 * @returns How the load ended.
 */
function runProbe(overrides: Readonly<Record<string, string>>): IProbeRun {
  const env = envWith(overrides);
  const options = { cwd: REPO_ROOT, encoding: 'utf8' as const, env };
  const run = spawnSync(process.execPath, ['-e', PROBE], options);
  return { status: run.status ?? -1, stdout: run.stdout, stderr: run.stderr };
}

/**
 * Load both configs and parse the report, failing on a bad exit.
 * @param overrides - Variables to set; pass {@link UNSET} to leave the knob out.
 * @returns The probe's report.
 */
function probe(overrides: Readonly<Record<string, string>>): IProbe {
  const run = runProbe(overrides);
  if (run.status !== 0) throw new RangeError(`config load failed: ${run.stderr}`);
  return JSON.parse(run.stdout) as IProbe;
}

/**
 * Every file under one CI directory.
 * @param dir - Directory relative to the repo root.
 * @returns Repo-relative file paths.
 */
function filesUnder(dir: string): string[] {
  const root = join(REPO_ROOT, dir);
  const names = readdirSync(root, { recursive: true, encoding: 'utf8' });
  const paths = names.map((name): string => join(dir, name));
  return paths.filter((path): boolean => isFile(path));
}

/**
 * Whether a repo-relative path is a regular file.
 * @param path - Repo-relative path.
 * @returns True for a file, false for a directory.
 */
function isFile(path: string): boolean {
  const absolute = join(REPO_ROOT, path);
  const stats = statSync(absolute);
  return stats.isFile();
}

/**
 * Shell text as the shell runs it: whole-line comments dropped first (a
 * comment's trailing backslash continues nothing), then continuations joined.
 * @param text - Shell source, or one YAML string value.
 * @returns The code.
 */
function shellCode(text: string): string {
  const uncommented = text.replace(SHELL_COMMENT, '');
  return uncommented.replace(CONTINUATION, ' ');
}

/**
 * JS source reprinted without comments, so code after a block comment stays.
 * @param text - JS source.
 * @returns The code.
 */
function jsCode(text: string): string {
  const kind = ts.ScriptKind.JS;
  const source = ts.createSourceFile('ci.js', text, ts.ScriptTarget.Latest, true, kind);
  const printer = ts.createPrinter({ removeComments: true });
  return printer.printFile(source);
}

/**
 * Every key and string value of a parsed YAML node, depth first.
 * @param node - A parsed YAML value.
 * @returns The strings; numbers and booleans carry no command.
 */
function yamlStrings(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap((item: unknown): string[] => yamlStrings(item));
  if (node === null || typeof node !== 'object') return [];
  const entries = Object.entries(node);
  return entries.flatMap(([key, value]): string[] => [key, ...yamlStrings(value)]);
}

/**
 * YAML as the runner sees it: comments gone, folded scalars joined, each
 * string read as shell (`run:` bodies and `env:` keys alike).
 * @param text - YAML source.
 * @returns The code.
 */
function yamlCode(text: string): string {
  const doc: unknown = parse(text);
  const strings = yamlStrings(doc);
  return strings.map((value): string => shellCode(value)).join('\n');
}

/** How to read each CI file type; any other type is scanned as raw text. */
const CODE_OF: Readonly<Record<string, (text: string) => string>> = {
  '.yml': yamlCode,
  '.yaml': yamlCode,
  '.sh': shellCode,
  '.js': jsCode,
  '.cjs': jsCode,
  '.mjs': jsCode,
};

/**
 * A file's code, read by its type.
 * @param path - File path; only its extension matters.
 * @param text - File contents.
 * @returns The code.
 */
function codeOf(path: string, text: string): string {
  const read = CODE_OF[extname(path)] ?? ((raw: string): string => raw);
  return read(text);
}

/**
 * Whether one command may take the suite off its default worker count.
 * @param command - One command.
 * @param isOpaque - Whether it comes from a file type in {@link OPAQUE}.
 * @returns True when it runs the suite from JS, or as anything but a safe run.
 */
function overridesSuite(command: string, isOpaque: boolean): boolean {
  if (!SUITE_RUN.test(command)) return false;
  const words = command.trim().split(/\s+/);
  const normalised = words.join(' ');
  return isOpaque || !SAFE_SUITE_RUNS.has(normalised);
}

/**
 * What in a piece of code takes the suite off its default worker count:
 * any mention of the knob, and each command {@link overridesSuite} flags.
 * @param code - Code from {@link codeOf}.
 * @param isOpaque - Whether the code comes from a file type in {@link OPAQUE}.
 * @returns The offending snippets; empty when the default holds.
 */
function workerOverrides(code: string, isOpaque: boolean): string[] {
  const commands = code.split(COMMAND_BREAK);
  const flagged = commands.filter((cmd): boolean => overridesSuite(cmd, isOpaque));
  const knob = code.includes(KNOB) ? [KNOB] : [];
  return [...knob, ...flagged.map((cmd): string => cmd.trim())];
}

/**
 * The overrides in one CI file.
 * @param path - Repo-relative file path.
 * @returns `path: snippet` for each.
 */
function fileOverrides(path: string): string[] {
  const absolute = join(REPO_ROOT, path);
  const text = readFileSync(absolute, 'utf8');
  const code = codeOf(path, text);
  const type = extname(path);
  const isOpaque = OPAQUE.has(type);
  const found = workerOverrides(code, isOpaque);
  return found.map((hit): string => `${path}: ${hit}`);
}

/**
 * Every CI override of the suite's worker count.
 * @returns `path: snippet` entries; empty when CI keeps the default.
 */
function ciOverrides(): string[] {
  const files = CI_DIRS.flatMap((dir): string[] => filesUnder(dir));
  return files.flatMap((path): string[] => fileOverrides(path));
}

/**
 * The words of `test:pipeline` that {@link SUITE_SCRIPT_WORD} does not allow.
 * @returns The offending words; empty when the script keeps the default.
 */
function suiteScriptExtras(): string[] {
  const words = npmScript('test:pipeline').split(/\s+/);
  return words.filter((word): boolean => !SUITE_SCRIPT_WORD.test(word));
}

/**
 * The overrides in one npm script, which CI may call instead of the suite.
 * `test:pipeline` itself defines the suite, so {@link suiteScriptExtras} checks it.
 * @param name - Script name.
 * @param command - Its command line.
 * @returns `name: snippet` for each.
 */
function scriptOverrides(name: string, command: string): string[] {
  if (name === 'test:pipeline') return [];
  const code = shellCode(command);
  const found = workerOverrides(code, false);
  return found.map((hit): string => `${name}: ${hit}`);
}

/** `[label, file name, text]` for the scanner's self-test. */
type ScanCase = readonly [string, string, string];

/** Overrides the scanner must report, one per spelling or hiding place. */
const CAUGHT: readonly ScanCase[] = [
  ['the knob in a job env', 'w.yml', "jobs:\n  t:\n    env:\n      JEST_MAX_WORKERS: '4'\n"],
  ['the knob written to $GITHUB_ENV', 'w.yml', 'run: echo "JEST_MAX_WORKERS=4" >> "$GITHUB_ENV"\n'],
  ['the knob in JS', 'a.cjs', "process.env.JEST_MAX_WORKERS = '4';\n"],
  ['a folded run', 'w.yml', 'run: >\n  npm run test:pipeline\n  -- --maxWorkers=4\n'],
  ['a continued run', 'w.yml', 'run: |\n  npm run test:pipeline \\\n    -- -w4\n'],
  ['-w=4', 's.sh', 'npm run test:pipeline -- -w=4\n'],
  ['-w 4', 's.sh', 'npm run test:pipeline -- -w 4\n'],
  ['--max-workers=4', 's.sh', 'npm run test:pipeline -- --max-workers=4\n'],
  ['--maxWorkers 4', 's.sh', 'npm run test:pipeline -- --maxWorkers 4\n'],
  ['--run-in-band', 's.sh', 'npm run test:pipeline -- --run-in-band\n'],
  ['-i', 's.sh', 'npm run test:pipeline -- -i\n'],
  [
    'Jest run on the suite config',
    's.sh',
    'npx jest --config=jest.pipeline.suite.config.cjs --runInBand\n',
  ],
  [
    'a case arm starting with *',
    's.sh',
    'case "$x" in\n  *) npm run test:pipeline -- -w4 ;;\nesac\n',
  ],
  ['code after a comment ending in \\', 's.sh', '# note \\\nnpm run test:pipeline -- -w4\n'],
  ['code after a block comment', 'a.cjs', "/* note */ execSync('npm run test:pipeline -- -w4');\n"],
  ['an argv array', 'a.mjs', "spawn('npm', ['run', 'test:pipeline', '--', '--maxWorkers=4']);\n"],
  ['JS that runs the suite at all', 'a.cjs', "spawn('npm', ['run', 'test:pipeline', ...args]);\n"],
  [
    'arguments from a step env',
    'w.yml',
    'env:\n  JEST_ARGS: --maxWorkers=4\nrun: npm run test:pipeline -- $JEST_ARGS\n',
  ],
  ['arguments from an expression', 'w.yml', 'run: npm run test:pipeline -- ${{ inputs.args }}\n'],
  ['forwarded script arguments', 's.sh', 'npm run test:pipeline -- "$@"\n'],
  ['a command substitution', 's.sh', 'npm run test:pipeline -- $(cat jest-args)\n'],
  ['backticks', 's.sh', 'npm run test:pipeline -- `cat jest-args`\n'],
  ['xargs', 's.sh', 'echo -- -w4 | xargs npm run test:pipeline\n'],
  ['eval', 's.sh', 'eval "npm run test:pipeline $ARGS"\n'],
  ['a second config', 's.sh', 'npm run test:pipeline -- --config=jest.pipeline.config.cjs\n'],
  ['-c', 's.sh', 'npm run test:pipeline -- -c jest.pipeline.config.cjs\n'],
  ['an option that forces one worker', 's.sh', 'npm run test:pipeline -- --detectOpenHandles\n'],
  ['a wrapping command', 'w.yml', 'run: timeout 600 npm run test:pipeline\n'],
];

/** Text the scanner must pass: comments, other commands, the plain default. */
const IGNORED: readonly ScanCase[] = [
  ['a YAML comment', 'w.yml', '# JEST_MAX_WORKERS: 4 was a NO-GO\non: push\n'],
  ['a shell comment', 's.sh', '# npm run test:pipeline -- -w4\nnpm run test:pipeline\n'],
  [
    'JS comments',
    'a.cjs',
    "// npm run test:pipeline -w4\n/* JEST_MAX_WORKERS */\nrun('npm run lint');\n",
  ],
  [
    'a variable on the line before',
    'w.yml',
    'run: |\n  if [ "$COVERAGE" = true ]; then\n    npm run test:pipeline\n  fi\n',
  ],
  ['a flag on the next command', 's.sh', 'npm run test:pipeline && npx jest -w4\n'],
  ['the default run', 'w.yml', 'run: npm run test:pipeline -- --coverage=false\n'],
  ['another suite', 's.sh', 'npm run test:e2e:mock -- --maxWorkers=2\n'],
];

/**
 * Scan one self-test case.
 * @param name - File name, for its type.
 * @param text - File contents.
 * @returns What the scanner reported.
 */
function scan(name: string, text: string): string[] {
  const code = codeOf(name, text);
  const type = extname(name);
  const isOpaque = OPAQUE.has(type);
  return workerOverrides(code, isOpaque);
}

describe('PipelineWorkersGate — test:pipeline worker count', () => {
  it('PWG-1: test:pipeline reads the suite config and passes Jest only allowed words', () => {
    const script = npmScript('test:pipeline');
    const extras = suiteScriptExtras();
    expect(script).toContain(`--config=${SUITE_CONFIG}`);
    expect(extras).toEqual([]);
  });

  it('PWG-1: no other npm script overrides the suite workers', () => {
    const all = npmScripts();
    const scripts = Object.entries(all);
    const offenders = scripts.flatMap(([name, command]): string[] =>
      scriptOverrides(name, command),
    );
    expect(offenders).toEqual([]);
  });

  it('PWG-2: test:memory reads the shared config, which sets no worker count', () => {
    const script = npmScript('test:memory');
    expect(script).toContain(`--config=${BASE_CONFIG}`);
    expect(script).not.toMatch(WORKER_FLAG);
    expect(probe(UNSET).baseHasWorkers).toBe(false);
  });

  it.each(ACCEPTED)(
    'PWG-3: %s resolves to maxWorkers %p over the shared config',
    (_label, want, overrides) => {
      const report = probe(overrides);
      expect(report).toEqual({ maxWorkers: want, sameAsBase: true, baseHasWorkers: false });
    },
  );

  it.each(REJECTED)('PWG-4: %p fails the config load', value => {
    const run = runProbe({ [KNOB]: value });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(`${KNOB} must be a positive integer or 1-100%`);
  });

  it('PWG-5: no CI code overrides the worker count, so CI runs the default 2', () => {
    const offenders = ciOverrides();
    expect(offenders).toEqual([]);
    expect(probe(UNSET).maxWorkers).toBe('2');
  });

  it.each(CAUGHT)('PWG-6: the scanner catches %s', (_label, name, text) => {
    const found = scan(name, text);
    expect(found).not.toEqual([]);
  });

  it.each(IGNORED)('PWG-6: the scanner skips %s', (_label, name, text) => {
    const found = scan(name, text);
    expect(found).toEqual([]);
  });
});
