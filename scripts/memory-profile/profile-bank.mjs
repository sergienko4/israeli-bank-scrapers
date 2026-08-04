#!/usr/bin/env node
/**
 * Peak-memory profiler for a single real bank scrape.
 *
 * Spawns the same isolated `jest --runInBand` subprocess that
 * `scripts/run-real-suite.ts` uses for one bank, then samples the whole
 * descendant process tree (Node + Camoufox + every Firefox content
 * process) until the run exits.
 *
 * Measuring `process.memoryUsage()` inside Node would understate the
 * real footprint by roughly an order of magnitude, because the browser
 * lives in sibling OS processes that Node never accounts for.
 *
 * The scrape's own stdout is written to a gitignored run log and never
 * echoed, because real transaction output contains account-level PII.
 *
 * Windows only: the sampler is a PowerShell/WMI script, because Node has
 * no portable way to read the working set of a *sibling* process tree.
 *
 * Usage:
 *   node scripts/memory-profile/profile-bank.mjs Discount --mode=mocked
 *   node scripts/memory-profile/profile-bank.mjs Discount --mode=real
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const RUNS = join(HERE, 'runs');
const HAPPY_PATH_TEST_NAME = 'scrapes transactions successfully';
const MB = 1024 * 1024;

/**
 * Jest path/name filters per run mode. The `real` mode mirrors
 * `spawnBank` in scripts/run-real-suite.ts so the measured run has the
 * same shape as a production suite run. The mocked modes drive the same
 * Camoufox browser against local fixtures instead of a live bank.
 */
const MODE_FILTERS = {
  real: bank => [
    '--testPathIgnorePatterns=E2eMocked',
    `--testPathPatterns=/${bank}\\.e2e-real\\.test\\.ts`,
    `--testNamePattern=${HAPPY_PATH_TEST_NAME}`,
  ],
  mocked: bank => [`--testPathPatterns=/${bank}\\.e2e-mocked\\.test\\.ts`],
  suite: () => ['--testPathPatterns=e2e-mocked\\.test\\.ts'],
  custom: pattern => [`--testPathPatterns=${pattern}`],
};

const TSX_CLI = join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs');

/**
 * Commands that are profiled without Jest. Jest and ts-jest dominate
 * the Node-side footprint, so a consumer-shaped measurement has to run
 * outside them.
 */
const STANDALONE_SCRIPTS = {
  standalone: join(HERE, 'standalone-browser.ts'),
};

/**
 * Read one flag's value from argv.
 * @param args - Raw argv slice.
 * @param name - Flag name without dashes.
 * @returns The value, or undefined when absent.
 */
function flagValue(args, name) {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/**
 * Read the target, run mode and sampling interval from argv.
 * @returns Parsed CLI options.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const mode = flagValue(args, 'mode') ?? 'mocked';
  const known = [...Object.keys(MODE_FILTERS), ...Object.keys(STANDALONE_SCRIPTS)];
  if (!known.includes(mode)) throw new Error(`--mode must be one of ${known.join('|')}`);
  const bank = args.find(a => !a.startsWith('--')) ?? 'all';
  const interval = Number.parseInt(flagValue(args, 'interval') ?? '500', 10);
  return { bank, mode, interval: Number.isNaN(interval) ? 500 : interval };
}

/**
 * Build the argv for one profiled run, either through Jest or through
 * the Jest-free tsx harness.
 * @param bank - Capitalised bank stem, or "all" for the suite mode.
 * @param mode - A key of MODE_FILTERS or STANDALONE_SCRIPTS.
 * @returns Argv array for `node`.
 */
function buildRunArgs(bank, mode) {
  if (STANDALONE_SCRIPTS[mode]) return [TSX_CLI, STANDALONE_SCRIPTS[mode]];
  return [
    '--experimental-vm-modules',
    join('node_modules', 'jest', 'bin', 'jest.js'),
    '--runInBand',
    '--forceExit',
    '--testPathIgnorePatterns=/node_modules/',
    ...MODE_FILTERS[mode](bank),
  ];
}

/**
 * Fail fast off Windows. The sampler is PowerShell-based, so elsewhere the
 * spawn would fail into stderr and the run would still finish, reporting
 * "No samples captured" — which misattributes the cause.
 * @returns Nothing. Throws when the platform is unsupported.
 */
function requireWindows() {
  if (process.platform === 'win32') return;
  throw new Error(`the memory profiler requires Windows; platform=${process.platform}`);
}

/**
 * Start the PowerShell tree sampler against a root PID.
 * @param rootPid - PID of the spawned jest process.
 * @param interval - Sampling interval in milliseconds.
 * @returns The sampler child process.
 */
function startSampler(rootPid, interval) {
  const script = join(HERE, 'sampler.ps1');
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
    '-RootPid',
    String(rootPid),
    '-IntervalMs',
    String(interval),
  ];
  const proc = spawn('powershell.exe', args, { windowsHide: true });
  proc.stderr.on('data', d => process.stderr.write(`[sampler] ${d}`));
  proc.on('error', e => process.stderr.write(`[sampler] spawn failed: ${e.message}\n`));
  return proc;
}

/**
 * Total working set and private bytes for one sample.
 * @param sample - Decoded sampler line.
 * @returns Totals in bytes plus process count.
 */
function totals(sample) {
  const ws = sample.procs.reduce((sum, p) => sum + p.ws, 0);
  const pb = sample.procs.reduce((sum, p) => sum + p.pb, 0);
  return { ws, pb, count: sample.procs.length };
}

/**
 * Collect sampler stdout lines into an array of decoded samples.
 * @param sampler - Sampler child process.
 * @param sink - Array that receives decoded samples.
 */
function collectSamples(sampler, sink) {
  const rl = readline.createInterface({ input: sampler.stdout });
  rl.on('line', line => {
    const text = line.trim();
    if (!text.startsWith('{')) return;
    try {
      sink.push(JSON.parse(text));
    } catch {
      /* partial line during teardown — skip */
    }
  });
}

/**
 * Group a sample's processes by executable name, summing working set.
 * @param sample - Sample to break down.
 * @returns Rows of {name, count, ws} sorted by descending ws.
 */
function breakdown(sample) {
  const byName = new Map();
  for (const p of sample.procs) {
    const row = byName.get(p.name) ?? { name: p.name, count: 0, ws: 0 };
    byName.set(p.name, { name: p.name, count: row.count + 1, ws: row.ws + p.ws });
  }
  return [...byName.values()].sort((a, b) => b.ws - a.ws);
}

/**
 * Find the sample with the highest total working set.
 * @param samples - All decoded samples.
 * @returns The peak sample, or undefined when nothing was sampled.
 */
function peakSample(samples) {
  return samples.reduce(
    (best, s) => (!best || totals(s).ws > totals(best).ws ? s : best),
    undefined,
  );
}

/**
 * Format a bytes value as megabytes with one decimal.
 * @param bytes - Value in bytes.
 * @returns Right-aligned MB string.
 */
function mb(bytes) {
  return `${(bytes / MB).toFixed(1)} MB`;
}

/**
 * Largest detached-browser footprint seen at any point in the run,
 * including the grace samples taken after the root process exits — an
 * orphan only becomes visible once its tree is gone.
 * @param samples - All decoded samples.
 * @returns Peak stray process count and working set in bytes.
 */
function peakStrays(samples) {
  const count = samples.reduce((m, s) => Math.max(m, s.strays ?? 0), 0);
  const ws = samples.reduce((m, s) => Math.max(m, s.strayWs ?? 0), 0);
  return { count, ws };
}

/**
 * Print the peak-memory report for a completed run.
 * @param ctx - Bank name, samples, start time and exit code.
 */
function report(ctx) {
  const peak = peakSample(ctx.samples);
  if (!peak) return console.log('No samples captured — the run exited too fast.');
  const t = totals(peak);
  console.log(`\n=== PEAK MEMORY — ${ctx.bank} (${ctx.mode}) ===`);
  console.log(`exit code            ${ctx.exitCode}`);
  console.log(`samples              ${ctx.samples.length} @ ${ctx.interval}ms`);
  console.log(
    `peak at              +${((peak.t - ctx.startedAt) / 1000).toFixed(1)}s into the run`,
  );
  const strays = peakStrays(ctx.samples);
  console.log(`peak processes       ${t.count}`);
  console.log(
    `detached browsers    ${strays.count} peak, ${mb(strays.ws)} — excluded from the totals below`,
  );
  console.log(`PEAK WORKING SET     ${mb(t.ws)}`);
  console.log(`peak private bytes   ${mb(t.pb)}`);
  console.log('\nComposition at peak:');
  for (const r of breakdown(peak))
    console.log(`  ${r.name.padEnd(24)} x${String(r.count).padEnd(3)} ${mb(r.ws)}`);
}

/**
 * Reduce a run label to characters that are safe in a filename, so a
 * regex-shaped `--mode=custom` pattern cannot create stray directories.
 * @param label - Raw bank stem or test-path pattern.
 * @returns Filename-safe slug.
 */
function slug(label) {
  const cleaned = label.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 60) || 'run';
}

/**
 * Persist the raw timeline so a run can be re-analysed without rerunning.
 * @param ctx - Bank name and captured samples.
 * @returns Path of the written JSON file.
 */
function persist(ctx) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(RUNS, `${slug(ctx.bank)}-${ctx.mode}-${stamp}.json`);
  const timeline = ctx.samples.map(s => ({ t: s.t, ...totals(s) }));
  writeFileSync(
    file,
    JSON.stringify({ bank: ctx.bank, mode: ctx.mode, interval: ctx.interval, timeline }, null, 2),
  );
  return file;
}

/**
 * Wait until the child has actually spawned, so a failed spawn surfaces as
 * a rejection through `main().catch` rather than an uncaught 'error' event.
 * Keeping the listener attached also stops later errors being re-thrown.
 * @param child - The spawned run process.
 * @returns Resolves on 'spawn', rejects with the spawn error.
 */
function awaitSpawn(child) {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('spawn', resolve);
  });
}

/**
 * Flush the run log to disk before reporting, so the file the summary
 * points at is complete by the time the reader opens it. Piping the child
 * output already ends the stream, so the close may have happened first.
 * @param log - The run-log write stream.
 * @returns Resolves once the stream has closed.
 */
function closeLog(log) {
  if (log.closed) return Promise.resolve();
  return new Promise(resolve => {
    log.on('close', resolve);
    log.on('error', resolve);
    log.end();
  });
}

async function main() {
  const { bank, mode, interval } = parseArgs();
  requireWindows();
  mkdirSync(RUNS, { recursive: true });
  const logPath = join(RUNS, `${slug(bank)}-${mode}-scrape.log`);
  const log = createWriteStream(logPath);
  console.log(`Profiling ${bank} (${mode}) — run output goes to ${logPath}`);
  const child = spawn('node', buildRunArgs(bank, mode), {
    cwd: REPO,
    env: process.env,
    shell: false,
  });
  await awaitSpawn(child);
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const samples = [];
  const sampler = startSampler(child.pid, interval);
  collectSamples(sampler, samples);
  const startedAt = Date.now();
  const exitCode = await new Promise(resolve => child.on('close', resolve));
  sampler.kill();
  await closeLog(log);
  report({ bank, mode, samples, startedAt, exitCode, interval });
  console.log(`\nTimeline written to ${persist({ bank, mode, samples, interval })}`);
  process.exitCode = exitCode ?? 1;
}

main().catch(e => {
  process.stderr.write(`FATAL: ${e.message}\n`);
  process.exitCode = 1;
});
