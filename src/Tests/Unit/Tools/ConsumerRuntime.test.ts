import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { parse } from 'yaml';

import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import { canRunPosixBash } from '../../Helpers/HostCapabilities.js';
import { createTempRepo, writeTempFile } from '../../Helpers/TempRepoTree.js';

interface IActionStep {
  readonly id?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly with?: Readonly<Record<string, string>>;
}

interface IAction {
  readonly outputs: Readonly<Record<string, { readonly value: string }>>;
  readonly runs: { readonly steps: readonly IActionStep[] };
}

const ROOT = process.cwd();
const ACTION_PATH = join(ROOT, '.github/actions/setup-consumer-runtime/action.yml');
const SCRIPT_PATH = join(ROOT, '.github/scripts/ci/consumer-install.sh');
const RETIRE_WORKER_END_PATH = join(ROOT, 'src/Scrapers/Pipeline/Logging/RetireWorkerEnd.ts');
const PROBE_FILE = 'layout-probe.cjs';

/**
 * Reads the actual runtime-setup action.
 * @returns Parsed composite action.
 */
function action(): IAction {
  const source = readFileSync(ACTION_PATH, 'utf8');
  return parse(source) as IAction;
}

/**
 * Executes the action's floor extraction with an isolated manifest.
 * @param range Consumer engine range.
 * @returns Step exit status and output.
 */
function floorFor(range: string): { status: number; output: string } {
  const root = createTempRepo();
  try {
    const output = join(root, 'output');
    const manifest = JSON.stringify({ engines: { node: range } });
    writeTempFile(root, 'package.json', manifest);
    const run = action().runs.steps.find(step => step.id === 'floor')?.run ?? '';
    const result = spawnSync('bash', ['-euc', run], {
      cwd: root,
      env: { ...process.env, GITHUB_OUTPUT: output },
    });
    return {
      status: result.status ?? -1,
      output: result.status === 0 ? readFileSync(output, 'utf8') : '',
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('consumer runtime setup', () => {
  it.each(['24.11.0', '26.1.0'])(
    'derives %s from the manifest instead of a second pin',
    version => {
      if (canRunPosixBash(process.platform)) {
        const result = floorFor(`>= ${version}`);
        expect(result).toEqual({ status: 0, output: `version=${version}\n` });
      }
    },
  );

  it('rejects a range without an unambiguous supported floor', () => {
    if (canRunPosixBash(process.platform)) {
      const result = floorFor('^24 || ^26');
      expect(result.status).not.toBe(0);
    }
  });

  it('captures the floor binary before restoring the build runtime', () => {
    const steps = action().runs.steps;
    const sequence = steps.map(step => step.id ?? step.with);
    const outputs = action().outputs;
    expect(sequence).toEqual([
      'floor',
      { 'node-version': '${{ steps.floor.outputs.version }}' },
      'binary',
      { 'node-version-file': '.nvmrc' },
    ]);
    expect(steps[2].run).toContain("node -p 'process.execPath'");
    expect(outputs['node-path'].value).toBe('${{ steps.binary.outputs.path }}');
  });
});

/** Facts about a fake consumer install the layout probe inspects. */
interface IFakeGraph {
  readonly range: string;
  readonly pino: string;
  readonly threadStream: string;
  readonly writeIndex: number;
  readonly readIndex: number;
  /** Length of the fake `kImpl.state`, or `false` for a stream without the record. */
  readonly stateLength: number | false;
}

/** Exit status and trimmed stdout of one probe run. */
interface IProbeRun {
  readonly status: number;
  readonly output: string;
}

/** A graph inside the supported range with the layout retirement writes into. */
const SUPPORTED_GRAPH: IFakeGraph = {
  range: '^10.3.1',
  pino: '10.4.0',
  threadStream: '4.0.0',
  writeIndex: 4,
  readIndex: 8,
  stateLength: 32,
};

/**
 * Extract the probe `consumer-install.sh` writes into the scratch consumer project.
 * @returns The probe's JavaScript source, or an empty string when it is absent.
 */
function probeSource(): string {
  const script = readFileSync(SCRIPT_PATH, 'utf8');
  const match = /<<'LAYOUT_PROBE'\n([\s\S]*?)\nLAYOUT_PROBE\n/u.exec(script);
  return match?.[1] ?? '';
}

/**
 * Collect the top-level `const NAME = value;` declarations of a source file.
 * @param source File contents.
 * @returns Declared constant values by name.
 */
function constantsOf(source: string): Readonly<Record<string, string>> {
  const pairs = [...source.matchAll(/^const (\w+) = ([^;]+);$/gmu)];
  const entries = pairs.map((pair): [string, string] => [pair[1], pair[2]]);
  return Object.fromEntries(entries);
}

/**
 * Read a package manifest's `version`.
 * @param manifest Absolute `package.json` path.
 * @returns The declared version.
 */
function manifestVersion(manifest: string): string {
  const text = readFileSync(manifest, 'utf8');
  const parsed = JSON.parse(text) as { version: string };
  return parsed.version;
}

/**
 * Resolve the pino and thread-stream versions installed for this repository.
 * @returns Installed versions, resolving thread-stream the way pino does.
 */
function installedVersions(): { pino: string; threadStream: string } {
  const rootManifest = join(ROOT, 'package.json');
  const fromRoot = createRequire(rootManifest);
  const pinoManifest = fromRoot.resolve('pino/package.json');
  const threadManifest = createRequire(pinoManifest).resolve('thread-stream/package.json');
  return { pino: manifestVersion(pinoManifest), threadStream: manifestVersion(threadManifest) };
}

/**
 * Write the fake pino whose transport stream exposes `graph`'s `kImpl` record.
 * @param root Fixture root.
 * @param graph Facts the probe will inspect.
 * @returns Path of the fake pino entry point.
 */
function writeFakePino(root: string, graph: IFakeGraph): string {
  const length = String(graph.stateLength);
  const record = `{ state: new Int32Array(${length}), flushing: false, ending: false, buf: '' }`;
  const attach = graph.stateLength === false ? '' : `stream[Symbol('kImpl')] = ${record};`;
  const source = `const stream = { on() {}, end() {} };\n${attach}\nmodule.exports = { transport: () => stream };`;
  const manifest = JSON.stringify({ version: graph.pino });
  writeTempFile(root, 'node_modules/pino/package.json', manifest);
  return writeTempFile(root, 'node_modules/pino/index.js', source);
}

/**
 * Write the fake thread-stream publishing `graph`'s version and offsets.
 * @param root Fixture root.
 * @param graph Facts the probe will inspect.
 * @returns Path of the fake `lib/indexes.js`.
 */
function writeFakeThreadStream(root: string, graph: IFakeGraph): string {
  const manifest = JSON.stringify({ version: graph.threadStream });
  const write = String(graph.writeIndex);
  const read = String(graph.readIndex);
  writeTempFile(root, 'node_modules/thread-stream/package.json', manifest);
  return writeTempFile(
    root,
    'node_modules/thread-stream/lib/indexes.js',
    `module.exports = { WRITE_INDEX: ${write}, READ_INDEX: ${read} };`,
  );
}

/**
 * Write a fake consumer install exposing `graph`.
 * @param root Fixture root, used as both project and package directory.
 * @param graph Facts the probe will inspect.
 * @returns The package directory to hand the probe.
 */
function writeFakeGraph(root: string, graph: IFakeGraph): string {
  const manifest = JSON.stringify({ dependencies: { pino: graph.range } });
  writeTempFile(root, 'package.json', manifest);
  writeFakePino(root, graph);
  writeFakeThreadStream(root, graph);
  return root;
}

/**
 * Run the extracted probe with Node, exactly as `consumer-install.sh` does.
 * @param cwd Scratch working directory the probe is written into.
 * @param packageDir Directory whose manifest and resolution the probe inspects.
 * @returns Exit status and trimmed stdout.
 */
function runProbe(cwd: string, packageDir: string): IProbeRun {
  const source = probeSource();
  const file = writeTempFile(cwd, PROBE_FILE, source);
  const result = spawnSync(process.execPath, [file, packageDir], { cwd, encoding: 'utf8' });
  return { status: result.status ?? -1, output: result.stdout.trim() };
}

/**
 * Run the probe against a fake consumer install in an isolated fixture.
 * @param graph Facts the fake install exposes.
 * @returns Exit status and trimmed stdout.
 */
function runProbeOnFake(graph: IFakeGraph): IProbeRun {
  const root = createTempRepo();
  try {
    const packageDir = writeFakeGraph(root, graph);
    return runProbe(root, packageDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** One unsupported graph the probe must reject, with the reason it must name. */
interface IRejectedGraph {
  readonly id: string;
  readonly name: string;
  readonly graph: IFakeGraph;
  readonly reason: RegExp;
}

const REJECTED_GRAPHS: readonly IRejectedGraph[] = [
  {
    id: 'CRL-3a',
    name: 'pino above the packed range',
    graph: { ...SUPPORTED_GRAPH, pino: '11.0.0' },
    reason: /pino 11\.0\.0 is outside the packed range \^10\.3\.1/u,
  },
  {
    id: 'CRL-3b',
    name: 'pino below the packed range minimum',
    graph: { ...SUPPORTED_GRAPH, pino: '10.2.9' },
    reason: /pino 10\.2\.9 is outside the packed range/u,
  },
  {
    id: 'CRL-3c',
    name: 'an unsupported thread-stream major',
    graph: { ...SUPPORTED_GRAPH, threadStream: '5.0.0' },
    reason: /thread-stream 5\.0\.0 is outside the supported major 4/u,
  },
  {
    id: 'CRL-3d',
    name: 'moved shared-state offsets',
    graph: { ...SUPPORTED_GRAPH, writeIndex: 0, readIndex: 4 },
    reason: /thread-stream offsets 0\/4 moved from 4\/8/u,
  },
  {
    id: 'CRL-3e',
    name: 'a stream without the kImpl record',
    graph: { ...SUPPORTED_GRAPH, stateLength: false },
    reason: /carries no kImpl state record/u,
  },
  {
    id: 'CRL-3f',
    name: 'a kImpl state too short for READ_INDEX',
    graph: { ...SUPPORTED_GRAPH, stateLength: 8 },
    reason: /kImpl\.state is not an Int32Array covering READ_INDEX/u,
  },
];

describe('consumer dependency-layout probe', () => {
  it('[CRL-1] accepts the pino and thread-stream graph installed for this repository', () => {
    const root = createTempRepo();
    try {
      const result = runProbe(root, ROOT);
      const versions = installedVersions();
      expect(result.status).toBe(0);
      expect(result.output).toContain(
        `pino ${versions.pino}, thread-stream ${versions.threadStream}`,
      );
      expect(result.output).toContain('kImpl layout intact');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('[CRL-2] accepts a conforming fake graph, so each rejection below isolates one change', () => {
    const result = runProbeOnFake(SUPPORTED_GRAPH);
    expect(result.status).toBe(0);
    expect(result.output).toContain('kImpl layout intact');
  });

  it.each(REJECTED_GRAPHS)('[$id] rejects $name', row => {
    const result = runProbeOnFake(row.graph);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(row.reason);
    const isFailure = result.output.startsWith('FAIL:');
    expect(isFailure).toBe(true);
  });

  it('[CRL-4] pins the same offsets and symbol as the retirement code, and the installed major', () => {
    const probeText = probeSource();
    const probe = constantsOf(probeText);
    const retireSource = readFileSync(RETIRE_WORKER_END_PATH, 'utf8');
    const retire = constantsOf(retireSource);
    const names = ['WRITE_INDEX', 'READ_INDEX', 'IMPL_SYMBOL'];
    const probeValues = names.map(name => probe[name]);
    const retireValues = names.map(name => retire[name]);
    expect(probeValues).toEqual(retireValues);
    expect(retire.WRITE_INDEX).toBeDefined();
    const installedMajor = installedVersions().threadStream.split('.')[0];
    expect(probe.SUPPORTED_THREAD_STREAM_MAJOR).toBe(installedMajor);
  });

  it('[CRL-5] runs under the floor runtime before any consumer environment and fails the gate', () => {
    const script = readFileSync(SCRIPT_PATH, 'utf8');
    expect(script).toContain('"$CONSUMER_NODE" ./layout-probe.cjs "${package_dir}"');
    const call = script.search(/^assert_dependency_layout "\$\{PKG_DIR\}"$/mu);
    const environments = script.search(/^for program in /mu);
    expect(call).toBeGreaterThan(-1);
    expect(call).toBeLessThan(environments);
    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('FAILED=1');
  });
});

/**
 * The part of `consumer-install.sh` that decides whether a smoke's output is the
 * expected one: its expectation constants and the two functions that apply them.
 * The rest of the script packs and installs, which a unit test must not do.
 * @returns The decision logic as runnable bash, or an empty string when it is absent.
 */
function gateDecisionSource(): string {
  const script = readFileSync(SCRIPT_PATH, 'utf8');
  const constants = script.match(/^(?:EXPECTED_|GRAPHQL_EXPECTED_|SETTLED_MARKER)\w*=.*$/gmu) ?? [];
  const expectations = /^expectations_for\(\) \{\n[\s\S]+?\n\}$/mu.exec(script)?.[0] ?? '';
  const assertion = /^assert_expected_outcome\(\) \{\n[\s\S]+?\n\}$/mu.exec(script)?.[0] ?? '';
  return [...constants, 'FAILED=0', expectations, assertion].join('\n');
}

/** What the gate concluded about one smoke output. */
interface IGateVerdict {
  readonly isAccepted: boolean;
  readonly isFailureRecorded: boolean;
}

/**
 * Feed one smoke output to the script's own decision logic under real bash.
 * @param scenario Scenario the output claims to come from.
 * @param output What the smoke printed.
 * @returns Whether the gate accepted it and whether it recorded a failure.
 * @throws ScraperError when bash did not run or printed no verdict, so a harness that
 * never ran can never be read as the gate rejecting the output.
 */
function judge(scenario: string, output: string): IGateVerdict {
  const program = `${gateDecisionSource()}\nassert_expected_outcome "$SMOKE_OUT" "$SMOKE_SCENARIO" >/dev/null\nstatus=$?\necho "status=$status failed=$FAILED"`;
  const env = { ...process.env, SMOKE_OUT: output, SMOKE_SCENARIO: scenario };
  const result = spawnSync('bash', ['-c', program], { env, encoding: 'utf8' });
  if (result.status !== 0) {
    const cause = String(result.error ?? result.status);
    throw new ScraperError(`the gate harness did not run: ${cause}`);
  }
  const reported = /status=(\d) failed=(\d)/u.exec(result.stdout);
  if (reported === null) throw new ScraperError('the gate harness printed no verdict');
  return { isAccepted: reported[1] === '0', isFailureRecorded: reported[2] === '1' };
}

const LEUMI_OK = [
  'OFFLINE_REQUEST',
  'SETTLED result {"success":false,"errorType":"GENERIC","errorMessage":"prime HTTP 503"}',
].join('\n');

const PEPPER_OK = [
  'SETTLED result {"success":true,"accounts":[]}',
  'GRAPHQL_OPERATIONS Transactions,UserDataV2,fetchAccountBalance',
  'GRAPHQL_UNEXPECTED 0',
  'GRAPHQL_VERDICT ok',
].join('\n');

/** One smoke output with the verdict the gate must reach on it. */
interface IGateCase {
  readonly id: string;
  readonly name: string;
  readonly scenario: string;
  readonly output: string;
  readonly isAccepted: boolean;
}

const GATE_CASES: readonly IGateCase[] = [
  {
    id: 'CRL-6a',
    name: 'the Leumi 503 outcome under its own scenario',
    scenario: 'leumi-503',
    output: LEUMI_OK,
    isAccepted: true,
  },
  {
    id: 'CRL-6b',
    name: 'the Pepper GraphQL outcome under its own scenario',
    scenario: 'pepper-graphql',
    output: PEPPER_OK,
    isAccepted: true,
  },
  {
    id: 'CRL-6c',
    name: 'the Pepper outcome presented as the Leumi scenario',
    scenario: 'leumi-503',
    output: PEPPER_OK,
    isAccepted: false,
  },
  {
    id: 'CRL-6d',
    name: 'the Leumi outcome presented as the Pepper scenario',
    scenario: 'pepper-graphql',
    output: LEUMI_OK,
    isAccepted: false,
  },
  {
    id: 'CRL-6e',
    name: 'a GraphQL run that failed its scrape',
    scenario: 'pepper-graphql',
    output: PEPPER_OK.replace('"success":true', '"success":false'),
    isAccepted: false,
  },
  {
    id: 'CRL-6f',
    name: 'a GraphQL run that served an unexpected request',
    scenario: 'pepper-graphql',
    output: PEPPER_OK.replace('UNEXPECTED 0', 'UNEXPECTED 1 url https://bank.example/graphql'),
    isAccepted: false,
  },
  {
    id: 'CRL-6g',
    name: 'a GraphQL run whose typed result did not match',
    scenario: 'pepper-graphql',
    output: PEPPER_OK.replace('VERDICT ok', 'VERDICT mismatch: balance'),
    isAccepted: false,
  },
  {
    id: 'CRL-6h',
    name: 'a GraphQL run that skipped an operation',
    scenario: 'pepper-graphql',
    output: PEPPER_OK.replace('Transactions,', ''),
    isAccepted: false,
  },
  {
    id: 'CRL-6i',
    name: 'a run that printed nothing',
    scenario: 'pepper-graphql',
    output: '',
    isAccepted: false,
  },
  {
    id: 'CRL-6j',
    name: 'a scenario the gate does not know',
    scenario: 'no-such-scenario',
    output: PEPPER_OK,
    isAccepted: false,
  },
];

describe('consumer-install gate decisions', () => {
  it.each(GATE_CASES)('[$id] judges $name', row => {
    if (canRunPosixBash(process.platform)) {
      const verdict = judge(row.scenario, row.output);
      expect(verdict.isAccepted).toBe(row.isAccepted);
      expect(verdict.isFailureRecorded).toBe(!row.isAccepted);
    }
  });

  it('[CRL-7] runs every smoke program under every scenario and both environments', () => {
    const script = readFileSync(SCRIPT_PATH, 'utf8');
    const loop = /^for program in [\s\S]+?\ndone$/mu.exec(script)?.[0] ?? '';
    expect(loop).toContain('for program in smoke.cjs smoke.mjs');
    expect(loop).toContain('for scenario in leumi-503 pepper-graphql');
    expect(loop).toContain('"default (CI and NODE_ENV unset)" -u CI -u NODE_ENV -u PRETTY_LOGS');
    expect(loop).toContain('"NODE_ENV=production" -u CI -u PRETTY_LOGS NODE_ENV=production');
  });

  it('[CRL-8] passes the scenario to the program as an argument, never through the environment', () => {
    const script = readFileSync(SCRIPT_PATH, 'utf8');
    expect(script).toContain('"$CONSUMER_NODE" "./${program}" "${scenario}"');
    const cjsPath = join(ROOT, '.github/scripts/ci/consumer-smoke.cjs');
    const esmPath = join(ROOT, '.github/scripts/ci/consumer-smoke.mjs');
    const smoke = readFileSync(cjsPath, 'utf8');
    const esm = readFileSync(esmPath, 'utf8');
    expect(smoke).toContain('process.argv[2]');
    expect(esm).toContain('process.argv[2]');
  });
});
