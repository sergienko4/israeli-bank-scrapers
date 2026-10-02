/**
 * Scorecard npm-pin gate.
 *
 * <p>OpenSSF Scorecard's `PinnedDependenciesID` classifies every `npm install`,
 * `npm i`, `npm install-test` and `npm update` as an unpinned download. An exact
 * version such as `npm@11.11.0` does not count as a pin: the scanner accepts
 * `npm ci`, which installs from the committed lockfile, or a git URL pinned to
 * a full commit hash (`ossf/scorecard` `checks/raw/shell_download_validate.go`).
 * Code-scanning alerts #35 and #131 were both this rule, and #35 was once
 * declared closed by a comment claiming the exact pin was enough.
 *
 * <p>This is a repository policy, deliberately stricter than the scanner: the
 * first install subcommand decides, so `npm install ci` fails, and commit-pinned
 * git URLs fail too. It reads every file Scorecard parses as shell — workflows,
 * scripts by extension or sh/bash/mksh shebang, and Dockerfiles — and the
 * commands inside `sh -c` bodies, substitutions in double quotes and exec-form
 * `RUN`. It is a line heuristic, not Scorecard's shell parser: heredoc bodies
 * are read as ordinary lines, and commands built from variables or `eval` are
 * out of its reach.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const RELEASE_YAML = join(REPO_ROOT, '.github/workflows/release.yml');

/** npm subcommands Scorecard's `isNpmDownload` treats as an install; only `ci` is pinned. */
const INSTALL_SUBCOMMANDS = new Set(['ci', 'install', 'i', 'install-test', 'update']);

/**
 * Shell keywords and YAML/Dockerfile markers that can precede a command, in
 * lower case: Dockerfile instructions are case-insensitive.
 */
const COMMAND_PREFIXES = new Set([
  'run:',
  'run',
  '!',
  'if',
  'then',
  'do',
  'else',
  'while',
  'until',
]);

/**
 * Commands that run a command named later on their line, after options and
 * operands of their own (`sudo -u root CMD`, `timeout 600 CMD`).
 */
const WRAPPERS = new Set([
  'sudo',
  'env',
  'command',
  'nohup',
  'exec',
  'time',
  'nice',
  'timeout',
  'xargs',
]);

/** Shell operators after which a new command starts. */
const COMMAND_SEPARATOR = /&&|\|\||[;|(){}`]|\$\(/;
const QUOTED = /'[^']*'|"(?:\\.|[^"\\])*"/g;
const COMMENT = /(?:^|\s)#.*$/;
const ENV_ASSIGNMENT = /^[a-z_]\w*=/i;
/** `sh -c 'CMD'` and friends: the body is a command Scorecard parses too. */
const SHELL_OPTION = String.raw`(?:[-+][oO]\s+[^\s'"]+|--(?:rcfile|init-file)\s+[^\s'"]+|[-+]{1,2}[A-Za-z][\w-]*)\s+`;
/** The option bundle carrying `c` (first `c` anchors): the shell runs the next argument. */
const SHELL_C_FLAG_HEAD = String.raw`-[A-Zabd-z]*c[A-Za-z]*\s`;
const SHELL_C_BODY = new RegExp(
  String.raw`\b(?:ba|da|k|mk|z)?sh\s+(?:(?!${SHELL_C_FLAG_HEAD})${SHELL_OPTION})*${SHELL_C_FLAG_HEAD}+(?:${SHELL_OPTION})*(?:'([^']*)'|"((?:\\.|[^"\\])*)")`,
  'g',
);
/** `$(CMD)` or `` `CMD` `` inside a double-quoted string, which the shell still runs. */
const SUBSTITUTION = /\$\(([^()]*)\)|`([^`]*)`/g;
/** Dockerfile exec form: `RUN ["npm", "install"]`; instructions are case-insensitive. */
const EXEC_FORM = /^\s*RUN\s+(\[.*\])\s*$/i;
const JSON_STRING = /"((?:\\.|[^"\\])*)"/g;
const WORKFLOW_PATH = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const SHELL_EXTENSION = /\.(?:sh|bash|mksh)$/;
const SHELL_SHEBANG = /^#!.*\b(?:ba|mk)?sh\b/;
/** Lowest npm that can complete the Trusted Publishing OIDC exchange. */
const TRUSTED_PUBLISHING_NPM = '11.5.1';
/** First Node major whose bundled npm can reach that version. */
const MIN_PUBLISH_NODE_MAJOR = 24;
/** Bytes read from each tracked file to find a shebang. */
const SHEBANG_PROBE_BYTES = 128;

/** One logical shell line: physical lines joined across `\` continuations. */
interface ILogicalLine {
  readonly line: number;
  text: string;
}

/** A regex match's groups as they are at runtime: an unmatched group is undefined. */
type IRegexGroups = readonly (string | undefined)[];

interface IWorkflowStep {
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Readonly<Record<string, string | number | boolean | undefined>>;
}

interface IReleaseDoc {
  readonly jobs: Readonly<Record<string, { readonly steps: readonly IWorkflowStep[] }>>;
}

/**
 * Join backslash-continued lines, keeping the line number each one starts on.
 *
 * @param text - File contents.
 * @returns Logical lines in file order.
 */
function logicalLines(text: string): readonly ILogicalLine[] {
  const lines: ILogicalLine[] = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const previous = lines.at(-1);
    if (previous?.text.endsWith('\\')) previous.text = `${previous.text.slice(0, -1)} ${raw}`;
    else lines.push({ line: index + 1, text: raw });
  }
  return lines;
}

/**
 * Whether a word precedes the command rather than being it: an option such as
 * `-E` or `--mount=…`, a keyword, or `VAR=value`.
 *
 * @param word - One whitespace-separated word.
 * @returns True when the command starts later in the line.
 */
function isCommandPrefix(word: string): boolean {
  const lower = word.toLowerCase();
  return word.startsWith('-') || COMMAND_PREFIXES.has(lower) || ENV_ASSIGNMENT.test(word);
}

/**
 * Index of the word a command runs. Once a wrapper such as `sudo` appears —
 * bare or path-qualified — its own options and their values (`-u root`) are
 * skipped until `npm` turns up; deliberately strict, since a wrapper's option
 * arity varies.
 *
 * @param words - The command's whitespace-separated words.
 * @returns Index of the command word, or -1 when there is none.
 */
function commandIndex(words: readonly string[]): number {
  let isWrapped = false;
  for (const [index, word] of words.entries()) {
    const name = basename(word);
    if (name === 'npm') return index;
    const isWrapper = WRAPPERS.has(name);
    if (!isWrapped && !isWrapper && !isCommandPrefix(word)) return index;
    isWrapped ||= isWrapper;
  }
  return -1;
}

/**
 * Whether one shell command installs through npm without a lockfile. The first
 * install subcommand decides, so `npm --prefix app ci` passes and
 * `npm install ci` does not.
 *
 * @param command - A single command, quotes and comments already removed.
 * @returns True when the command is an unpinned npm download.
 */
function isUnpinnedNpm(command: string): boolean {
  const words = command.trim().split(/\s+/);
  const start = commandIndex(words);
  if (start < 0 || basename(words[start]) !== 'npm') return false;
  const args = words.slice(start + 1).map(word => word.toLowerCase());
  const subcommand = args.find(arg => INSTALL_SUBCOMMANDS.has(arg));
  return subcommand !== undefined && subcommand !== 'ci';
}

/**
 * Remove a trailing shell comment, ignoring `#` inside quotes.
 *
 * @param line - One logical line.
 * @returns The line up to its comment.
 */
function stripComment(line: string): string {
  const masked = line.replace(QUOTED, quoted => '_'.repeat(quoted.length));
  const comment = COMMENT.exec(masked);
  return comment === null ? line : line.slice(0, comment.index);
}

/**
 * The first defined capture group of every match.
 *
 * @param text - Text to search.
 * @param pattern - A global pattern with one or two alternative groups.
 * @returns One captured string per match.
 */
function captures(text: string, pattern: RegExp): readonly string[] {
  const matches: readonly IRegexGroups[] = [...text.matchAll(pattern)];
  return matches.map(match => match[1] ?? match[2] ?? '');
}

/**
 * Commands run by substitutions inside double-quoted strings.
 *
 * @param code - One line, comment removed.
 * @returns The substituted commands.
 */
function substitutionsIn(code: string): readonly string[] {
  const quoted = code.match(QUOTED) ?? [];
  const doubleQuoted = quoted.filter(text => text.startsWith('"'));
  return doubleQuoted.flatMap(text => captures(text, SUBSTITUTION));
}

/**
 * The command a Dockerfile exec-form `RUN` runs, as one space-joined line.
 *
 * @param code - One line, comment removed.
 * @returns The command, or nothing when the line is not exec form.
 */
function execFormCommand(code: string): readonly string[] {
  const execForm = EXEC_FORM.exec(code);
  if (execForm === null) return [];
  const args = captures(execForm[1], JSON_STRING);
  return [args.join(' ')];
}

/**
 * Commands hidden inside quotes that still run: `sh -c` bodies, substitutions
 * in double quotes, and Dockerfile exec form.
 *
 * @param code - One line, comment removed.
 * @returns The embedded commands, still to be split.
 */
function embeddedCommands(code: string): readonly string[] {
  const shellBodies = captures(code, SHELL_C_BODY);
  const substitutions = substitutionsIn(code);
  const execForm = execFormCommand(code);
  return [...shellBodies, ...substitutions, ...execForm];
}

/**
 * Every command one logical line runs, including embedded ones.
 *
 * @param line - One logical line.
 * @returns Commands with quotes and comments removed.
 */
function commandsIn(line: string): readonly string[] {
  const code = stripComment(line);
  const direct = code.replace(QUOTED, '""').split(COMMAND_SEPARATOR);
  const embedded = embeddedCommands(code).flatMap(commandsIn);
  return [...direct, ...embedded];
}

/**
 * Find every unpinned npm download in a file's text.
 *
 * @param text - File contents.
 * @returns `line: source` for each offending logical line.
 */
function findUnpinnedNpm(text: string): readonly string[] {
  return logicalLines(text)
    .filter(({ text: raw }) => commandsIn(raw).some(isUnpinnedNpm))
    .map(({ line, text: raw }) => `${String(line)}: ${raw.trim()}`);
}

/**
 * Every `run:` script in a parsed workflow, as YAML decodes it: a folded or
 * multi-line plain scalar becomes the one command the runner executes.
 *
 * @param node - Any node of the parsed document.
 * @returns The scripts, in document order.
 */
function runScripts(node: unknown): readonly string[] {
  if (Array.isArray(node)) return node.flatMap(runScripts);
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) =>
    key === 'run' && typeof value === 'string' ? [value] : runScripts(value),
  );
}

/**
 * Find every unpinned npm download in one scanned file. Workflows are read
 * twice: line by line, and as their decoded `run:` scripts.
 *
 * @param path - Repository-relative path, which decides how the text is read.
 * @param text - File contents.
 * @returns `line: source` for each offending line or `run:` script.
 */
function findUnpinnedInFile(path: string, text: string): readonly string[] {
  const lineHits = findUnpinnedNpm(text);
  if (!WORKFLOW_PATH.test(path)) return lineHits;
  const document: unknown = parse(text);
  const runHits = runScripts(document).flatMap(findUnpinnedNpm);
  return [...lineHits, ...runHits.map(hit => `run: ${hit}`)];
}

/**
 * Whether a repository-relative path exists in the working tree.
 *
 * @param path - Repository-relative path.
 * @returns True when the file is on disk.
 */
function existsInTree(path: string): boolean {
  const absolute = join(REPO_ROOT, path);
  return existsSync(absolute);
}

/**
 * Read a repository file as UTF-8.
 *
 * @param path - Repository-relative path.
 * @returns File contents.
 */
function readRepoFile(path: string): string {
  const absolute = join(REPO_ROOT, path);
  return readFileSync(absolute, 'utf8');
}

/**
 * Whether Scorecard reads this tracked file as a workflow, script or Dockerfile.
 *
 * @param path - Repository-relative path.
 * @param head - The file's first bytes, where a shebang would be.
 * @returns True when the file is in the scanner's scope.
 */
function isScannedFile(path: string, head: string): boolean {
  const name = basename(path);
  if (WORKFLOW_PATH.test(path) || SHELL_EXTENSION.test(name)) return true;
  return /dockerfile/i.test(name) || SHELL_SHEBANG.test(head);
}

/**
 * Read the first bytes of a repository file, enough to hold a shebang.
 *
 * @param path - Repository-relative path.
 * @returns The file's leading text.
 */
function fileHead(path: string): string {
  const absolute = join(REPO_ROOT, path);
  const descriptor = openSync(absolute, 'r');
  const buffer = Buffer.alloc(SHEBANG_PROBE_BYTES);
  const length = readSync(descriptor, buffer, 0, SHEBANG_PROBE_BYTES, 0);
  closeSync(descriptor);
  return buffer.toString('utf8', 0, length);
}

/**
 * List tracked files Scorecard scans for pinned dependencies.
 *
 * @returns Repository-relative paths that exist in the working tree.
 */
function scannedFiles(): readonly string[] {
  const listing = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const tracked = listing.split('\0').filter(path => path.length > 0 && existsInTree(path));
  return tracked.filter(path => {
    const head = fileHead(path);
    return isScannedFile(path, head);
  });
}

/**
 * Read the steps of the release workflow's publish job.
 *
 * @returns Steps in execution order.
 */
function publishSteps(): readonly IWorkflowStep[] {
  const text = readFileSync(RELEASE_YAML, 'utf8');
  const doc = parse(text) as IReleaseDoc;
  return doc.jobs.publish.steps;
}

/**
 * Index of the first publish-job step whose `run` script contains `needle`.
 *
 * @param needle - Text the step's script must contain.
 * @returns Step index, or -1 when no step matches.
 */
function stepIndexRunning(needle: string): number {
  return publishSteps().findIndex(step => step.run?.includes(needle) ?? false);
}

/**
 * Whether a workflow step is `actions/setup-node`.
 *
 * @param step - Workflow step.
 * @returns True for a setup-node step.
 */
function isSetupNode(step: IWorkflowStep): boolean {
  return step.uses?.startsWith('actions/setup-node@') ?? false;
}

/**
 * Create a directory holding a fake `npm` that prints `$STUB_NPM_VERSION`.
 *
 * @returns The directory, to prepend to `PATH`.
 */
function makeNpmStub(): string {
  const temp = tmpdir();
  const prefix = join(temp, 'snp-npm-');
  const dir = mkdtempSync(prefix);
  const stub = join(dir, 'npm');
  writeFileSync(stub, '#!/bin/sh\necho "$STUB_NPM_VERSION"\n');
  chmodSync(stub, 0o755);
  return dir;
}

/**
 * Run the publish job's npm guard while `npm --version` reports `version`.
 *
 * @param version - Version the stub npm reports.
 * @param stubDir - Directory holding the stub npm.
 * @returns The guard's exit status.
 */
function guardExitFor(version: string, stubDir: string): number {
  const guard = publishSteps().find(step => step.run?.includes(TRUSTED_PUBLISHING_NPM) ?? false);
  const script = guard?.run ?? 'exit 99';
  const env = {
    ...process.env,
    PATH: `${stubDir}:${process.env.PATH ?? ''}`,
    STUB_NPM_VERSION: version,
  };
  const result = spawnSync('bash', ['-c', script], { env, encoding: 'utf8' });
  return result.status ?? -1;
}

/** A command and whether the policy must call it an unpinned download. */
interface IPolicyCase {
  readonly command: string;
  readonly unpinned: boolean;
}

const POLICY_CASES: readonly IPolicyCase[] = [
  { command: 'npm install -g npm@11.11.0 --ignore-scripts', unpinned: true },
  { command: 'npm i "${TARBALL}" --omit=dev --ignore-scripts', unpinned: true },
  { command: 'sudo npm update', unpinned: true },
  { command: 'sudo -E npm install', unpinned: true },
  { command: 'sudo -u root npm install left-pad', unpinned: true },
  { command: '/usr/bin/sudo -u root npm install left-pad', unpinned: true },
  { command: '/usr/bin/env -u CI npm install left-pad', unpinned: true },
  { command: 'env -u CI npm install left-pad', unpinned: true },
  { command: 'timeout 600 npm install', unpinned: true },
  { command: 'nice -n 10 npm i left-pad', unpinned: true },
  { command: 'xargs npm install', unpinned: true },
  { command: 'env CI=1 npm install', unpinned: true },
  { command: '/usr/local/bin/npm install-test', unpinned: true },
  { command: 'if npm install; then echo ok; fi', unpinned: true },
  { command: 'npm run build && npm install left-pad', unpinned: true },
  { command: 'CI=1 npm INSTALL left-pad', unpinned: true },
  { command: '- run: npm install', unpinned: true },
  { command: 'npm \\\n  install left-pad', unpinned: true },
  { command: 'npm install ci', unpinned: true },
  { command: "sh -c 'npm install left-pad'", unpinned: true },
  { command: 'bash -lc "npm i left-pad"', unpinned: true },
  { command: "bash --noprofile -c 'npm install left-pad'", unpinned: true },
  { command: "bash -O extglob -c 'npm install left-pad'", unpinned: true },
  { command: 'bash -o pipefail -ec "npm i left-pad"', unpinned: true },
  { command: "bash --rcfile /dev/null -c 'npm update'", unpinned: true },
  { command: 'echo "$(npm install left-pad)"', unpinned: true },
  { command: 'echo "`npm update`"', unpinned: true },
  { command: 'RUN --mount=type=cache,target=/root/.npm npm install', unpinned: true },
  { command: 'RUN ["npm", "install", "left-pad"]', unpinned: true },
  { command: 'run ["npm", "install", "left-pad"]', unpinned: true },
  { command: 'run npm install left-pad', unpinned: true },
  { command: 'RUN npm ci --prefer-offline --ignore-scripts', unpinned: false },
  { command: 'run npm ci', unpinned: false },
  { command: "bash --noprofile -c 'npm ci'", unpinned: false },
  { command: 'RUN ["npm", "ci"]', unpinned: false },
  { command: 'npm ci --omit=dev --ignore-scripts --no-audit --no-fund', unpinned: false },
  { command: 'npm --prefix app ci', unpinned: false },
  { command: 'sudo -u root npm ci', unpinned: false },
  { command: 'command -v npm', unpinned: false },
  { command: "sh -c 'npm ci'", unpinned: false },
  { command: 'NPM_VERSION="$(npm --version)"', unpinned: false },
  { command: 'npm pkg set name=consumer-smoke', unpinned: false },
  { command: 'npm run install-deps', unpinned: false },
  { command: 'echo "Consumers running \'npm install x\' still get it"', unpinned: false },
  { command: "echo 'a literal $(npm install x) is not run'", unpinned: false },
  { command: '# npm install -g npm@latest', unpinned: false },
  { command: '# echo "$(npm install x)"', unpinned: false },
  { command: 'npm run build ;# npm install -g npm@latest', unpinned: false },
  { command: '- name: npm install is never used here', unpinned: false },
];

/** A path, its leading bytes, and whether Scorecard parses it as shell. */
interface IScopeCase {
  readonly path: string;
  readonly head: string;
  readonly scanned: boolean;
}

const SCOPE_CASES: readonly IScopeCase[] = [
  { path: '.github/workflows/release.yml', head: 'name: Release', scanned: true },
  { path: 'scripts/check.sh', head: '', scanned: true },
  { path: '.husky/pre-commit', head: '#!/usr/bin/env sh', scanned: true },
  { path: 'scripts/release.hook', head: '#!/usr/bin/env bash\nset -e', scanned: true },
  { path: 'tools/build.v2', head: '#!/bin/mksh', scanned: true },
  { path: 'docker/Dockerfile.ci-mirror', head: 'FROM ubuntu', scanned: true },
  { path: 'scripts/check.mjs', head: '#!/usr/bin/env node', scanned: false },
  { path: 'tools/run.zsh', head: '#!/bin/zsh', scanned: false },
  { path: 'docs/workflow/releases.md', head: '# Releases', scanned: false },
];

/** A workflow whose `run:` scalar spans lines, and whether it installs unpinned. */
interface IFoldedCase {
  readonly name: string;
  readonly workflow: string;
  readonly unpinned: boolean;
}

const FOLDED_CASES: readonly IFoldedCase[] = [
  {
    name: 'folded block',
    workflow:
      'jobs:\n  a:\n    steps:\n      - run: >\n          npm\n          install left-pad\n',
    unpinned: true,
  },
  {
    name: 'plain multi-line scalar',
    workflow: 'jobs:\n  a:\n    steps:\n      - run: npm\n          install left-pad\n',
    unpinned: true,
  },
  {
    name: 'folded block running npm ci',
    workflow: 'jobs:\n  a:\n    steps:\n      - run: >\n          npm\n          ci\n',
    unpinned: false,
  },
];

/** A version the stub npm reports, and whether the guard must let it through. */
interface IGuardCase {
  readonly version: string;
  readonly accepted: boolean;
}

const GUARD_CASES: readonly IGuardCase[] = [
  { version: '10.9.9', accepted: false },
  { version: '11.4.2', accepted: false },
  { version: '11.5.0', accepted: false },
  { version: '11.5.1', accepted: true },
  { version: '11.19.0', accepted: true },
  { version: '12.0.0', accepted: true },
];

describe('Scorecard npm-pin gate', () => {
  it.each(POLICY_CASES)('[SNP-1] classifies `$command` (unpinned: $unpinned)', row => {
    const offenders = findUnpinnedNpm(row.command);
    expect(offenders.length > 0).toBe(row.unpinned);
  });

  it('[SNP-2] scans the files Scorecard reads, including extensionless shell hooks', () => {
    const files = scannedFiles();
    expect(files).toContain('.husky/pre-commit');
    expect(files).toContain('.github/workflows/release.yml');
    expect(files).toContain('.github/scripts/ci/consumer-install.sh');
  });

  it('[SNP-3] no Scorecard-scanned file downloads through npm without a lockfile', () => {
    const offenders = scannedFiles().flatMap(path => {
      const text = readRepoFile(path);
      const hits = findUnpinnedInFile(path, text);
      return hits.map(hit => `${path}:${hit}`);
    });
    expect(offenders).toEqual([]);
  });

  /**
   * npm only ships 11.5.1+ with Node 24.5+, and no Node 22 release bundles it,
   * so the publish job takes its npm from Node 24 instead of downloading one.
   * `check-latest` stops setup-node from settling for an older 24.x already in
   * the runner's tool cache.
   */
  it('[SNP-4] the publish job runs on a Node line that bundles Trusted Publishing npm', () => {
    const setupNode = publishSteps().find(isSetupNode);
    expect(setupNode?.with?.['node-version-file']).toBeUndefined();
    expect(setupNode?.with?.['check-latest']).toBe(true);
    const nodeVersion = String(setupNode?.with?.['node-version']);
    const major = Number.parseInt(nodeVersion, 10);
    expect(major).toBeGreaterThanOrEqual(MIN_PUBLISH_NODE_MAJOR);
  });

  it('[SNP-5] the publish job checks npm after setup-node, before install and publish', () => {
    const steps = publishSteps();
    const setupNodes = steps.filter(isSetupNode);
    const setupNode = steps.findIndex(isSetupNode);
    const guard = stepIndexRunning(TRUSTED_PUBLISHING_NPM);
    const install = stepIndexRunning('npm ci');
    const publish = stepIndexRunning('npm publish');
    expect(setupNodes).toHaveLength(1);
    expect(guard).toBeGreaterThan(setupNode);
    expect(install).toBeGreaterThan(guard);
    expect(publish).toBeGreaterThan(guard);
  });

  describe('[SNP-6] the npm guard, executed', () => {
    let stubDir = '';
    beforeAll(() => {
      stubDir = makeNpmStub();
    });
    afterAll(() => {
      rmSync(stubDir, { recursive: true, force: true });
    });

    it.each(GUARD_CASES)('npm $version is accepted: $accepted', row => {
      const status = guardExitFor(row.version, stubDir);
      expect(status === 0).toBe(row.accepted);
    });
  });

  it.each(SCOPE_CASES)('[SNP-7] $path is parsed as shell: $scanned', row => {
    const isScanned = isScannedFile(row.path, row.head);
    expect(isScanned).toBe(row.scanned);
  });

  it.each(FOLDED_CASES)('[SNP-8] reads a workflow `run:` as YAML decodes it: $name', row => {
    const offenders = findUnpinnedInFile('.github/workflows/folded.yml', row.workflow);
    expect(offenders.length > 0).toBe(row.unpinned);
  });
});
