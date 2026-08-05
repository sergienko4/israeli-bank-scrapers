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
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const RUNS = join(HERE, 'runs');
const HAPPY_PATH_TEST_NAME = 'scrapes transactions successfully';
const MB = 1024 * 1024;
const DEFAULT_INTERVAL_MS = 500;

/** Post-exit grace samples the sampler takes. Mirrors `$graceLeft` in sampler.ps1. */
const SAMPLER_GRACE_SAMPLES = 10;

/** Largest delay `setTimeout` accepts before it wraps to 1ms. */
const TIMEOUT_CEILING_MS = 2147483647;

/** Largest interval whose shutdown budget still fits `setTimeout`. */
const MAX_INTERVAL_MS = Math.floor(TIMEOUT_CEILING_MS / (SAMPLER_GRACE_SAMPLES * 2));

/**
 * Process names counted as browsers. Owned here rather than in the sampler
 * so the pre-spawn baseline and the sampler's stray check cannot drift.
 */
const BROWSER_PATTERN = 'camoufox|firefox|chrome|chromium|msedge';

/** Image name and PID columns of one `tasklist /fo csv` row. */
const TASK_ROW = /^"([^"]+)","(\d+)"/;

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
 * Coerce a flag to a strictly positive safe integer. Zero would turn the
 * sampler into a busy loop and a negative value would abort it outright, so
 * anything that is not a usable count falls back to the default.
 *
 * The upper bound matters because the interval also sizes the sampler's
 * shutdown budget. A budget past the 32-bit `setTimeout` ceiling is clamped
 * to 1ms, which would kill the sampler the instant the run exits and
 * silently zero the detached-browser metric.
 * @param raw - Raw flag value, possibly undefined.
 * @param fallback - Value used when `raw` is unusable.
 * @returns The parsed interval in milliseconds.
 */
function positiveInt(raw, fallback) {
  const n = Number(raw);
  const usable = Number.isSafeInteger(n) && n > 0 && n <= MAX_INTERVAL_MS;
  return usable ? n : fallback;
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
  const interval = positiveInt(flagValue(args, 'interval'), DEFAULT_INTERVAL_MS);
  return { bank, mode, interval };
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
 * PIDs of every browser process already running. Captured in Node *before*
 * the profiled run is spawned, so a browser that the run itself launches can
 * never be mistaken for a pre-existing one and dropped from the stray count.
 * @returns Baseline PIDs as strings.
 */
function browserBaseline() {
  const csv = execFileSync('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8' });
  const matcher = new RegExp(BROWSER_PATTERN, 'i');
  const rows = csv.split(/\r?\n/);
  const fields = rows.map(row => TASK_ROW.exec(row));
  return fields.filter(f => f && matcher.test(f[1])).map(f => f[2]);
}

/**
 * Build the PowerShell argv for the sampler.
 *
 * The baseline flag is omitted rather than sent empty, because PowerShell's
 * `-File` parser drops an empty argument and would then read the next flag
 * as the value — so a machine with no browser running would fail to sample.
 * @param rootPid - PID of the spawned run process.
 * @param interval - Sampling interval in milliseconds.
 * @param baseline - Browser PIDs captured before the run was spawned.
 * @returns Argv array for `powershell.exe`.
 */
function samplerArgs(rootPid, interval, baseline) {
  const script = join(HERE, 'sampler.ps1');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script];
  args.push('-RootPid', String(rootPid), '-IntervalMs', String(interval));
  args.push('-BrowserPattern', BROWSER_PATTERN);
  if (baseline.length > 0) args.push('-BaselinePids', baseline.join(','));
  return args;
}

/**
 * Start the PowerShell tree sampler against a root PID.
 * @param rootPid - PID of the spawned jest process.
 * @param interval - Sampling interval in milliseconds.
 * @param baseline - Browser PIDs captured before the run was spawned.
 * @returns The sampler process and a promise for its startup.
 */
function startSampler(rootPid, interval, baseline) {
  const args = samplerArgs(rootPid, interval, baseline);
  const proc = spawn('powershell.exe', args, { windowsHide: true });
  proc.stderr.on('data', d => process.stderr.write(`[sampler] ${d}`));
  return { proc, started: awaitSpawn(proc) };
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
 *
 * Detached-browser counters are kept per row: they are the reason this
 * profiler exists, and `totals` covers only the tracked tree, so dropping
 * them would leave the saved file unable to answer the question the run
 * was made to answer.
 * @param ctx - Bank name and captured samples.
 * @returns Path of the written JSON file.
 */
function persist(ctx) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(RUNS, `${slug(ctx.bank)}-${ctx.mode}-${stamp}.json`);
  const row = s => ({ t: s.t, ...totals(s), strays: s.strays, strayWs: s.strayWs });
  const timeline = ctx.samples.map(row);
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

/**
 * Spawn the profiled run and attach its output to the run log.
 * @param bank - Capitalised bank stem, or "all".
 * @param mode - Run mode key.
 * @param log - The run-log write stream.
 * @returns The spawned child, already piping into the log.
 */
async function spawnRun(bank, mode, log) {
  const spawnOptions = { cwd: REPO, env: process.env, shell: false };
  const child = spawn('node', buildRunArgs(bank, mode), spawnOptions);
  await awaitSpawn(child);
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return child;
}

/**
 * Wait for the sampler to finish its own post-exit grace period.
 *
 * The wait is bounded: Windows can recycle the exited run's PID, which would
 * keep the sampler's liveness check true and leave it running forever with
 * the report already collected. The budget covers the whole grace window
 * with headroom, so the kill only ever fires in that pathological case.
 * @param sampler - Sampler child process.
 * @param closed - Resolves when the sampler emits 'close'.
 * @param interval - Sampling interval in milliseconds.
 * @returns Resolves once the sampler has closed or been timed out.
 */
function awaitSampler(sampler, closed, interval) {
  const timer = setTimeout(() => sampler.kill(), interval * SAMPLER_GRACE_SAMPLES * 2);
  timer.unref();
  return closed.finally(() => clearTimeout(timer));
}

/**
 * Start the sampler and prove it is running before collection begins.
 *
 * A sampler that never spawns would otherwise leave the run to finish and
 * report "No samples captured", blaming a fast run for a tooling failure —
 * and `main` would still exit on the run's own code, so the profile would
 * look successful. The run is killed first, so nothing is left behind.
 * @param child - The already-spawned run process.
 * @param interval - Sampling interval in milliseconds.
 * @param baseline - Browser PIDs captured before the run was spawned.
 * @returns The sampler process and a promise for its close.
 */
async function startedSampler(child, interval, baseline) {
  const { proc, started } = startSampler(child.pid, interval, baseline);
  const closed = new Promise(resolve => proc.on('close', resolve));
  await started.catch(async e => {
    child.kill();
    await new Promise(resolve => child.on('close', resolve));
    throw new Error(`sampler failed to start: ${e.message}`);
  });
  return { proc, closed };
}

/**
 * Run the profiled command under the sampler.
 *
 * The sampler is not killed when the run exits: it keeps sampling for a
 * bounded grace period, because an orphaned browser only becomes observable
 * once the tree it belonged to is gone. Killing it here would make the
 * detached-browser metric permanently read zero.
 * @param options - Parsed CLI options.
 * @param log - The run-log write stream.
 * @returns Samples, run start time and the run's exit code.
 */
async function runAndSample({ bank, mode, interval }, log) {
  const baseline = browserBaseline();
  const child = await spawnRun(bank, mode, log);
  const { proc: sampler, closed } = await startedSampler(child, interval, baseline);
  const samples = [];
  collectSamples(sampler, samples);
  const startedAt = Date.now();
  const exitCode = await new Promise(resolve => child.on('close', resolve));
  await awaitSampler(sampler, closed, interval);
  return { samples, startedAt, exitCode };
}

async function main() {
  const options = parseArgs();
  requireWindows();
  mkdirSync(RUNS, { recursive: true });
  const logPath = join(RUNS, `${slug(options.bank)}-${options.mode}-scrape.log`);
  const log = createWriteStream(logPath);
  console.log(`Profiling ${options.bank} (${options.mode}) — run output goes to ${logPath}`);
  const run = await runAndSample(options, log);
  await closeLog(log);
  const ctx = { ...options, ...run };
  report(ctx);
  console.log(`\nTimeline written to ${persist(ctx)}`);
  process.exitCode = run.exitCode ?? 1;
}

main().catch(e => {
  process.stderr.write(`FATAL: ${e.message}\n`);
  process.exitCode = 1;
});
