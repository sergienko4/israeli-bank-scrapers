/**
 * Docs dependency pin gate.
 *
 * <p>The scheduled OpenSSF Scorecard scan raises `PinnedDependenciesID` for
 * every `pip install` that is not hash-pinned. The docs job is the only
 * Python consumer in the repository, and it installs
 * `requirements-docs.txt` in two workflows. Hash-pinning the lock and
 * installing it with `--require-hashes --only-binary=:all:` closes the gap:
 * hashes bind the selected archives, and binary-only stops a compromised index
 * from substituting a source build with unhashed build tooling.
 *
 * <p>This test is the regression guard. It reads the active workflow `run`
 * steps, compares the input pins with the lock's direct-input annotations in
 * both directions, rejects non-exact input pins, and proves the Scorecard
 * hard-fail parser understands the lock's hash continuation lines.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import ScraperError from '../../Scrapers/Base/ScraperError.js';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE);
const REPO_ROOT = join(THIS_DIR, '../../../');
const REQUIREMENTS = join(REPO_ROOT, 'requirements-docs.txt');
const REQUIREMENTS_INPUT = join(REPO_ROOT, 'requirements-docs.in');
const SCORECARD_HARD_FAIL = join(REPO_ROOT, '.github/workflows/scripts/scorecard-hardfail.sh');
const DETECT_CHANGES = join(REPO_ROOT, '.github/scripts/ci/detect-changes.sh');
const WORKFLOWS = [
  join(REPO_ROOT, '.github/workflows/docs.yml'),
  join(REPO_ROOT, '.github/workflows/pr.yml'),
] as const;

/** One workflow step, limited to the field this test reads. */
interface IWorkflowStep {
  readonly run?: string;
}

/** One workflow job, limited to the field this test reads. */
interface IWorkflowJob {
  readonly steps?: readonly IWorkflowStep[];
}

/** Parsed workflow document. */
interface IWorkflowDoc {
  readonly jobs?: Readonly<Record<string, IWorkflowJob>>;
}

/**
 * Join continuation lines into one logical requirement per package.
 * @param raw - Requirements file text.
 * @returns Logical requirement lines, without comments or blank lines.
 */
function logicalRequirements(raw: string): readonly string[] {
  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
  const logical: string[] = [];
  let current = '';
  for (const line of lines) {
    const isContinuation = line.endsWith('\\');
    const part = isContinuation ? line.slice(0, -1).trimEnd() : line;
    current = current.length > 0 ? `${current} ${part}` : part;
    if (!isContinuation) {
      logical.push(current);
      current = '';
    }
  }
  if (current.length > 0) logical.push(current);
  return logical;
}

/**
 * Read one exact `name==version` pin.
 * @param requirement - Logical requirement line.
 * @returns Lowercase package name and version.
 * @throws When the line is not an exact pin, so a range cannot hide a stale lock.
 */
function pinOf(requirement: string): readonly [string, string] {
  const match = /^([\w.-]+)==(\S+)/.exec(requirement);
  if (match === null) throw new ScraperError(`not an exact pin: ${requirement}`);
  const name = match[1];
  const version = match[2];
  const normalized = name.toLowerCase();
  return [normalized, version];
}

/**
 * Map every pinned package to its version.
 * @param raw - Requirements file text.
 * @returns Lowercase package name → pinned version.
 */
function pinsOf(raw: string): ReadonlyMap<string, string> {
  const pins = new Map<string, string>();
  for (const requirement of logicalRequirements(raw)) {
    const [name, version] = pinOf(requirement);
    pins.set(name, version);
  }
  return pins;
}

/**
 * Direct packages the lock annotates with `-r requirements-docs.in`.
 * Transitive-only packages are deliberately excluded.
 * @param raw - Generated lock text.
 * @returns Lowercase direct package name → pinned version.
 */
function directLockPins(raw: string): ReadonlyMap<string, string> {
  const pins = new Map<string, string>();
  const blocks = raw.split(/\n(?=[\w.-]+==)/);
  for (const block of blocks) {
    if (!/#\s+(?:via\s+)?-r requirements-docs\.in/.test(block)) continue;
    const header = block.split(/\r?\n/).find(line => /^[\w.-]+==/.test(line));
    if (header === undefined) continue;
    const [name, version] = pinOf(header);
    pins.set(name, version);
  }
  return pins;
}

/**
 * Remove an inline shell comment from one command line.
 * @param line - Trimmed command line.
 * @returns The command without its inline comment.
 */
function withoutShellComment(line: string): string {
  const match = /(?:^|\s)#/.exec(line);
  if (match === null) return line;
  return line.slice(0, match.index).trimEnd();
}

/**
 * Read the non-comment command lines from one step's `run` block.
 * @param step - Workflow step.
 * @returns Trimmed, active command lines.
 */
function runLinesOf(step: IWorkflowStep): readonly string[] {
  const active: string[] = [];
  for (const line of (step.run ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    const command = withoutShellComment(trimmed);
    if (command.length > 0) active.push(command);
  }
  return active;
}

/**
 * Collect every active command line from a workflow.
 * @param raw - Workflow YAML.
 * @returns Active command lines, comments excluded.
 */
function activeRunLines(raw: string): readonly string[] {
  const doc = parse(raw) as IWorkflowDoc;
  const jobs = Object.values(doc.jobs ?? {});
  const steps = jobs.flatMap(job => job.steps ?? []);
  return steps.flatMap(runLinesOf);
}

/**
 * Active commands that install the docs requirements.
 * @param path - Workflow path.
 * @returns Matching command lines.
 */
function pipDocsCommands(path: string): readonly string[] {
  const raw = readFileSync(path, 'utf8');
  return activeRunLines(raw).filter(
    command => command.includes('pip install') && command.includes('requirements-docs.txt'),
  );
}

/**
 * Parse a non-exact input line to prove ranges are rejected.
 * @returns Parsed pins; throws for a range.
 */
function parseRangedInput(): ReadonlyMap<string, string> {
  const pins = pinsOf('zensical>=0.2.0');
  return pins;
}

describe('docs dependency pins', () => {
  it('hash-pins every package in requirements-docs.txt', () => {
    const raw = readFileSync(REQUIREMENTS, 'utf8');
    const requirements = logicalRequirements(raw);
    expect(requirements.length).toBeGreaterThan(0);
    for (const requirement of requirements) {
      expect(requirement).toMatch(/^[\w.-]+==\S+/);
      expect(requirement).toContain('--hash=sha256:');
    }
  });

  it('rejects an input requirement that is not an exact pin', () => {
    expect(parseRangedInput).toThrow('not an exact pin');
  });

  it('keeps a final requirement that ends with a continuation', () => {
    const parsed = logicalRequirements('click==8.5.1 \\\n');
    expect(parsed).toEqual(['click==8.5.1']);
  });

  it('keeps the lock in step with requirements-docs.in in both directions', () => {
    const inputRaw = readFileSync(REQUIREMENTS_INPUT, 'utf8');
    const lockRaw = readFileSync(REQUIREMENTS, 'utf8');
    const inputPins = pinsOf(inputRaw);
    const directPins = directLockPins(lockRaw);
    expect(directPins.size).toBe(inputPins.size);
    for (const [name, version] of inputPins) {
      const lockedVersion = directPins.get(name);
      expect(lockedVersion).toBe(version);
    }
    for (const [name, version] of directPins) {
      const inputVersion = inputPins.get(name);
      expect(inputVersion).toBe(version);
    }
  });

  it.each(WORKFLOWS)(
    'installs the lock with hashes and binary-only in active steps of %s',
    path => {
      const commands = pipDocsCommands(path);
      expect(commands.length).toBeGreaterThan(0);
      for (const command of commands) {
        expect(command).toContain('--require-hashes');
        expect(command).toContain('--only-binary=:all:');
      }
    },
  );

  it('ignores install flags that only appear in a shell comment', () => {
    const step = {
      run: 'pip install -r requirements-docs.txt # --require-hashes --only-binary=:all:',
    };
    const lines = runLinesOf(step);
    expect(lines).toEqual(['pip install -r requirements-docs.txt']);
  });

  it('parses only requirement headers for the Scorecard lookup under Bash 3.2', () => {
    const lockRaw = readFileSync(REQUIREMENTS, 'utf8');
    const lockPins = pinsOf(lockRaw);
    const expected = [...lockPins.keys()].sort();
    const output = execFileSync('/bin/bash', [SCORECARD_HARD_FAIL, '--list-packages'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    const packages = output
      .trim()
      .split(/\r?\n/)
      .filter(line => line.length > 0)
      .map(line => line.toLowerCase())
      .sort();
    expect(packages).toEqual(expected);
  });

  it('classifies both requirements files into docs and CI scripts', () => {
    const raw = readFileSync(DETECT_CHANGES, 'utf8');
    const lines = raw.split(/\r?\n/);
    const docsLine = lines.find(line => line.includes('then docs=true')) ?? '';
    const ciLine = lines.find(line => line.includes('then ci_scripts=true')) ?? '';
    expect(docsLine).toContain('requirements-docs\\.(in|txt)');
    expect(ciLine).toContain('requirements-docs\\.(in|txt)');
  });
});
