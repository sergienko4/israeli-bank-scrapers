/**
 * Every pre-commit gate also runs in CI.
 *
 * <p>The hook keeps only fast, change-scoped and leak-preventing checks; the
 * repo-wide gates run in CI alone. That split is safe only while each gate
 * left in the hook has a CI step too: a fresh clone does not install the
 * hook, `--no-verify` skips it, and eight gates once ran nowhere else. This
 * suite reads the hook, collects every gate it runs, and requires the same
 * command in an executable `run:` step of a workflow or composite action, so
 * a gate can never again exist only on one developer's machine.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE);
const REPO_ROOT = join(THIS_DIR, '../../../');
const HOOK = '.husky/pre-commit';
const PR_YAML = '.github/workflows/pr.yml';
const PR_BODY_YAML = '.github/workflows/pr-body-check.yml';

/** One hook gate: what the hook runs, and the CI file and command that cover it. */
interface ICoverage {
  readonly hook: string;
  readonly file: string;
  readonly command: string;
}

/** Where CI runs each hook gate. */
const CI_STEP_FOR_GATE: Readonly<Record<string, ICoverage>> = {
  tsc: { hook: 'npm run type-check', file: PR_YAML, command: 'npm run type-check' },
  eslint: {
    hook: 'npx eslint',
    file: PR_YAML,
    command: "npx eslint src --max-warnings 0 --ignore-pattern '**/*.cjs'",
  },
  biome: {
    hook: 'npx biome lint',
    file: PR_YAML,
    command: 'npx biome lint src --max-diagnostics=50',
  },
  architecture: {
    hook: 'lint-and-validate.ts',
    file: PR_YAML,
    command: 'npm run lint:architecture src',
  },
  cycles: { hook: 'npm run lint:cycles', file: PR_YAML, command: 'npm run lint:cycles' },
  'fixtures-pii': {
    hook: 'npm run lint:fixtures-pii',
    file: PR_YAML,
    command: 'npm run lint:fixtures-pii',
  },
  'pii-staged': {
    hook: 'npm run lint:pii-staged',
    file: PR_YAML,
    command: 'npm run lint:pii-staged',
  },
  'plan-refs': {
    hook: 'npm run lint:plan-refs',
    file: PR_BODY_YAML,
    command: 'npm run lint:plan-refs',
  },
  'lint:plan-refs': {
    hook: 'npm run lint:plan-refs',
    file: PR_BODY_YAML,
    command: 'npm run lint:plan-refs',
  },
  prettier: {
    hook: 'npx prettier --write',
    file: PR_YAML,
    command: 'npx prettier --check "src/**/*.{ts,tsx,js,jsx,json,md}"',
  },
};

/** A `bg_gate "<label>"` call; the label names the gate. */
const BG_GATE = /^\s*bg_gate\s+"(?<label>[^"]+)"/u;

/** The command a `bg_gate` line runs: everything after its label and cache flag. */
const BG_GATE_COMMAND = /^\s*bg_gate\s+"[^"]+"\s+"[^"]+"\s+(?<command>\S.*)$/u;

/** An `npm run lint:<name>` call made directly, outside a `bg_gate`. */
const DIRECT_SCRIPT = /\bnpm run (?<script>lint:[\w:-]+)/u;

/** Reads a repo file as text. */
type FileReader = (relativePath: string) => string;

/** One gate the hook runs, with the hook line that runs it. */
interface IHookGate {
  readonly gate: string;
  readonly line: string;
}

/** A step or composite step that may carry a shell command. */
interface IRunStep {
  readonly run?: unknown;
}

/** The parts of a workflow or composite action that hold steps. */
interface IStepHolder {
  readonly jobs?: Readonly<Record<string, { readonly steps?: readonly IRunStep[] }>>;
  readonly runs?: { readonly steps?: readonly IRunStep[] };
}

/**
 * Read a repo file.
 * @param relativePath - Path from the repo root.
 * @returns File contents.
 */
function readRepoFile(relativePath: string): string {
  const absolutePath = join(REPO_ROOT, relativePath);
  return readFileSync(absolutePath, 'utf8');
}

/**
 * The hook's executable lines (comments and blanks dropped).
 * @param hook - Hook source.
 * @returns Lines that run.
 */
function codeLines(hook: string): readonly string[] {
  return hook.split('\n').filter(line => !/^\s*(?:#|$)/u.test(line));
}

/**
 * The gate one hook line runs, if any.
 * @param line - An executable hook line.
 * @returns Gate entries for the line (empty when it runs no gate).
 */
function gatesOnLine(line: string): readonly IHookGate[] {
  const label = BG_GATE.exec(line)?.groups?.label;
  if (label !== undefined) return [{ gate: label, line }];
  const script = DIRECT_SCRIPT.exec(line)?.groups?.script;
  const direct = script === undefined ? [] : [{ gate: script, line }];
  const prettier = line.includes('npx prettier --write') ? [{ gate: 'prettier', line }] : [];
  return [...direct, ...prettier];
}

/**
 * Every gate the hook runs, with the line that runs it.
 * @param hook - Hook source.
 * @returns Gate entries in file order.
 */
function hookGateLines(hook: string): readonly IHookGate[] {
  return codeLines(hook).flatMap(gatesOnLine);
}

/**
 * Every gate the hook runs.
 * @param hook - Hook source.
 * @returns Gate keys, each once.
 */
function hookGates(hook: string): readonly string[] {
  const entries = hookGateLines(hook);
  return [...new Set(entries.map(entry => entry.gate))];
}

/**
 * Every executable `run:` command in a workflow or composite action.
 * @param text - YAML text.
 * @returns Run commands; comments and prose are not included.
 */
function runCommands(text: string): readonly string[] {
  const doc = (parse(text) ?? {}) as IStepHolder;
  const jobSteps = Object.values(doc.jobs ?? {}).flatMap(job => job.steps ?? []);
  const actionSteps = doc.runs?.steps ?? [];
  const runs = [...jobSteps, ...actionSteps].map(step => step.run);
  return runs.filter((run): run is string => typeof run === 'string');
}

/**
 * Text with quotes removed, so a command matches however YAML quotes it.
 * @param text - Command text.
 * @returns The unquoted text.
 */
function unquoted(text: string): string {
  return text.replaceAll(/["']/gu, '');
}

/**
 * Whether CI runs the gate: it is mapped, and a `run:` step IS the command.
 * The whole step must equal it, so a shell comment or an `echo` naming the
 * command in an otherwise unrelated step does not count.
 * @param gate - Gate key from the hook.
 * @param read - File reader.
 * @returns True when a CI step runs the same command.
 */
function isInCi(gate: string, read: FileReader): boolean {
  if (!Object.hasOwn(CI_STEP_FOR_GATE, gate)) return false;
  const { file, command } = CI_STEP_FOR_GATE[gate];
  const ciText = read(file);
  const runs = runCommands(ciText).map(unquoted);
  const wanted = unquoted(command);
  return runs.some(run => run.trim() === wanted);
}

/**
 * Hook gates with no CI step.
 * @param hook - Hook source.
 * @param read - File reader.
 * @returns Uncovered gate keys.
 */
function uncoveredGates(hook: string, read: FileReader): readonly string[] {
  return hookGates(hook).filter(gate => !isInCi(gate, read));
}

/**
 * The command a hook line runs, without a `bg_gate` label and cache flag.
 * @param line - An executable hook line.
 * @returns The command text.
 */
function commandOf(line: string): string {
  return BG_GATE_COMMAND.exec(line)?.groups?.command ?? line;
}

/**
 * Hook lines whose command no longer matches the gate's mapped hook command.
 * @param hook - Hook source.
 * @returns Gate keys whose hook command drifted from the map.
 */
function driftedGates(hook: string): readonly string[] {
  const entries = hookGateLines(hook).filter(entry => Object.hasOwn(CI_STEP_FOR_GATE, entry.gate));
  const drifted = entries.filter(entry => {
    const command = commandOf(entry.line);
    return !command.includes(CI_STEP_FOR_GATE[entry.gate].hook);
  });
  return drifted.map(entry => entry.gate);
}

const SYNTHETIC_HOOK = [
  'bg_gate "tsc" "yes" npm run type-check',
  '# bg_gate "commented" "yes" npm run lint:commented',
  'bg_gate "made-up" "yes" npm run lint:made-up',
].join('\n');

/** A workflow that names the type check only in a comment. */
const COMMENT_ONLY_WORKFLOW =
  'jobs:\n  x:\n    steps:\n      # run: npm run type-check\n      - run: echo hi\n';

/** A `run:` block whose shell comment names the type check, then does something else. */
const SHELL_COMMENT_WORKFLOW =
  'jobs:\n  x:\n    steps:\n      - run: |\n          # npm run type-check\n          echo hi\n';

/** A step that only echoes the type-check command. */
const ECHO_ONLY_WORKFLOW = 'jobs:\n  x:\n    steps:\n      - run: echo npm run type-check\n';

describe('every pre-commit gate also runs in CI', () => {
  it('[HGC-1] the hook runs gates, and each one has a CI step', () => {
    const hook = readRepoFile(HOOK);
    const gates = hookGates(hook);
    const uncovered = uncoveredGates(hook, readRepoFile);
    expect(gates.length).toBeGreaterThan(5);
    expect(uncovered).toEqual([]);
  });

  it('[HGC-2] a gate with no CI mapping is reported', () => {
    const uncovered = uncoveredGates(SYNTHETIC_HOOK, readRepoFile);
    expect(uncovered).toEqual(['made-up']);
  });

  it('[HGC-3] a mapped gate whose CI step is gone is reported', () => {
    const uncovered = uncoveredGates('bg_gate "tsc" "yes" npm run type-check', () => '');
    expect(uncovered).toEqual(['tsc']);
  });

  it.each([
    ['a YAML comment', COMMENT_ONLY_WORKFLOW],
    ['a shell comment inside a run block', SHELL_COMMENT_WORKFLOW],
    ['an echo-only step', ECHO_ONLY_WORKFLOW],
  ])('[HGC-4] a command named only in %s does not count', (_label, workflow) => {
    const hook = 'bg_gate "tsc" "yes" npm run type-check';
    const uncovered = uncoveredGates(hook, () => workflow);
    expect(uncovered).toEqual(['tsc']);
  });

  it('[HGC-5] a commented-out gate is not counted', () => {
    const gates = hookGates(SYNTHETIC_HOOK);
    expect(gates).toEqual(['tsc', 'made-up']);
  });

  it('[HGC-6] every mapped gate is still in the hook, so the map cannot rot', () => {
    const hook = readRepoFile(HOOK);
    const gates = hookGates(hook);
    const stale = Object.keys(CI_STEP_FOR_GATE).filter(gate => !gates.includes(gate));
    expect(stale).toEqual([]);
  });

  it('[HGC-7] each hook gate still runs the command its CI step covers', () => {
    const hook = readRepoFile(HOOK);
    const drifted = driftedGates(hook);
    const relabelled = driftedGates('bg_gate "tsc" "yes" npm run lint:something-else');
    const sameLabel = driftedGates('bg_gate "eslint" "yes" npm run lint:something-else');
    expect(drifted).toEqual([]);
    expect(relabelled).toEqual(['tsc']);
    expect(sameLabel).toEqual(['eslint']);
  });
});
