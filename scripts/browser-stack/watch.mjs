/**
 * Weekly browser-stack watch: which playwright-core × Camoufox pairs could work?
 *
 * Reads the library's own playwright-core range, the Camoufox releases page
 * camoufox-js reads and the playwright-core packument, then runs the
 * browser-stack gate in `candidate` mode, with `--json`, on every candidate
 * version × candidate release. The release camoufox-js installs is always
 * among the pairs. The result is the markdown body of one issue (see
 * watch-report.mjs), printed and optionally written to `--out <file>`.
 *
 * Pairs are judged {@link GATE_CONCURRENCY} at a time, rows kept in pair
 * order, and every `Protocol.js` URL is fetched at most once per run: pairs
 * that share a schema share its fetch, and its failure.
 *
 * Exit codes: 0 report written, whatever it finds · 2 the watch cannot read
 * its inputs (USAGE, MANIFEST-INVALID, LOCKFILE-INVALID, PACKAGE-INVALID,
 * RANGE-UNSUPPORTED, FETCH-FAILED). A pair the gate cannot decide is
 * reported as unknown, not a failure.
 */
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  candidateReleases,
  fetchReleases,
  platformAssetCheck,
  selectRelease,
} from './camoufox-releases.mjs';
import { FetchFailedError } from './fetch-protocol.mjs';
import { runGate } from './gate.mjs';
import { GateInfraError, lockedPlaywright, readManifest } from './gate-inputs.mjs';
import {
  caretRange,
  dependencyRange,
  fetchPackument,
  playwrightCandidates,
} from './playwright-versions.mjs';
import { renderWatch } from './watch-report.mjs';

/**
 * @typedef {import('./camoufox-releases.d.mts').IRelease} IRelease
 * @typedef {import('./camoufox-releases.d.mts').ICandidateRelease} ICandidateRelease
 * @typedef {import('./camoufox-releases.d.mts').IPlatformAssetCheck} IPlatformAssetCheck
 * @typedef {import('./gate-inputs.mjs').Manifest} Manifest
 * @typedef {import('./playwright-versions.d.mts').ICaretRange} ICaretRange
 * @typedef {import('./playwright-versions.d.mts').IPackument} IPackument
 * @typedef {import('./watch.d.mts').IWatchIo} IWatchIo
 * @typedef {import('./watch-report.mjs').Verdict} Verdict
 * @typedef {import('./watch-report.mjs').WatchRow} WatchRow
 * @typedef {Required<IWatchIo>} WatchIo - Watch I/O, defaults filled in.
 * @typedef {Omit<WatchRow, 'verdict' | 'newPaths' | 'errors'>} Pair - One pair, not yet judged.
 * @typedef {ICandidateRelease & { readonly selected: boolean }} ReleaseRow - A release, marked.
 *
 * @typedef {object} Inputs - Everything the watch reads before any gate runs.
 * @property {Manifest} manifest - `browser-stack.json`.
 * @property {string} locked - The lockfile's playwright-core version.
 * @property {ICaretRange} range - The library's own playwright-core range.
 * @property {IRelease[]} releases - The releases page, newest first.
 * @property {IPackument} packument - The playwright-core packument.
 * @property {IPlatformAssetCheck} check - camoufox-js's asset check for this platform.
 *
 * @typedef {object} GateJson - The fields of the gate's `--json` report the watch reads.
 * @property {readonly { readonly path: string }[]} [new] - NEW deltas.
 * @property {readonly string[]} [errors] - Why the gate could not decide.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** How many gate runs are in flight at once. */
export const GATE_CONCURRENCY = 4;

/** Production I/O; tests override any member. */
const DEFAULT_IO = Object.freeze({
  manifestPath: `${ROOT}browser-stack.json`,
  lockfilePath: `${ROOT}package-lock.json`,
  packagePath: `${ROOT}package.json`,
  env: process.env,
  fetch: {},
  assetCheck: platformAssetCheck,
  runGate,
  now: () => new Date(),
  writeFile: (/** @type {string} */ path, /** @type {string} */ text) => writeFileSync(path, text),
  stdout: (/** @type {string} */ text) => process.stdout.write(text),
  stderr: (/** @type {string} */ text) => process.stderr.write(text),
});

/**
 * Gate verdict per gate exit code.
 *
 * @type {readonly Verdict[]}
 */
const VERDICTS = Object.freeze(['compatible', 'new', 'unknown']);

/** How every pair is checked: as a candidate, the report as JSON. */
const CANDIDATE_JSON = Object.freeze(['--mode', 'candidate', '--json']);

/** `--out`, or USAGE. */
function parseWatchArgs(/** @type {readonly string[]} */ args) {
  try {
    return parseArgs({ args: [...args], options: { out: { type: 'string' } } }).values;
  } catch (error) {
    throw new GateInfraError([`USAGE ${error instanceof Error ? error.message : String(error)}`]);
  }
}

/**
 * Manifest, lockfile version and range, read before any fetch; then releases page,
 * packument and asset check.
 *
 * @param {WatchIo} io - Watch I/O.
 * @returns {Promise<Inputs>} Everything the watch reads.
 */
async function readInputs(io) {
  const manifest = readManifest(io.manifestPath);
  const locked = lockedPlaywright(io.lockfilePath);
  const range = caretRange(dependencyRange(io.packagePath));
  const reading = [fetchReleases(io.env, io.fetch), fetchPackument(io.fetch), io.assetCheck()];
  const [releases, packument, check] = await Promise.all(
    /** @type {[Promise<IRelease[]>, Promise<IPackument>, Promise<IPlatformAssetCheck>]} */ (reading),
  );
  return { manifest, locked, range, releases, packument, check };
}

/**
 * Candidate releases, plus the selected one when it is not among them; it is marked.
 *
 * @param {readonly IRelease[]} releases - The releases page, newest first.
 * @param {string | null} selected - The tag camoufox-js installs, if any.
 * @returns {ReleaseRow[]} Rows, newest first, the selected release last when it is older.
 */
function releaseRows(releases, selected) {
  const rows = candidateReleases(releases);
  const listed = selected === null || rows.some(r => r.tag === selected);
  const all = listed ? rows : [...rows, { tag: selected, prerelease: false }];
  return all.map(r => ({ ...r, selected: r.tag === selected }));
}

/**
 * Every candidate version × release, the selected release marked.
 *
 * @param {Inputs} inputs - Everything the watch reads.
 * @param {string | null} selected - The tag camoufox-js installs, if any.
 * @returns {Pair[]} Pairs, version-major order.
 */
function pairsOf(inputs, selected) {
  const { manifest, locked, range, releases, packument } = inputs;
  const sources = { locked, testedMinor: manifest.playwrightCore.testedMinor, range };
  const versions = playwrightCandidates(packument, sources);
  const tags = releaseRows(releases, selected);
  return versions.flatMap(v => tags.map(t => ({ playwright: v.version, labels: v.labels, ...t })));
}

/** @type {(pair: Pair) => string[]} The gate arguments for one pair. */
const gateArgs = pair => [
  '--playwright',
  pair.playwright,
  '--camoufox',
  pair.tag,
  ...CANDIDATE_JSON,
];

/**
 * The gate's JSON report on one pair, run in candidate mode.
 *
 * @param {Pair} pair - The pair.
 * @param {WatchIo} io - Watch I/O; its `fetch` carries the run's protocol cache.
 * @returns {Promise<{ exit: 0 | 1 | 2, report: GateJson }>} Gate exit code and report.
 */
async function gateReport(pair, io) {
  let out = '';
  const capture = (/** @type {string} */ text) => ((out += text), true);
  const paths = { manifestPath: io.manifestPath, lockfilePath: io.lockfilePath };
  const gateIo = { ...paths, fetch: io.fetch, stdout: capture, stderr: () => true };
  const exit = await io.runGate(gateArgs(pair), gateIo);
  return { exit, report: JSON.parse(out.trim().split('\n').at(-1) ?? '') };
}

/**
 * One pair with its verdict, NEW paths and gate errors.
 *
 * @param {Pair} pair - The pair.
 * @param {WatchIo} io - Watch I/O.
 * @returns {Promise<WatchRow>} The judged pair.
 */
async function judge(pair, io) {
  const { exit, report } = await gateReport(pair, io);
  const newPaths = (report.new ?? []).map(d => d.path);
  return { ...pair, verdict: VERDICTS[exit], newPaths, errors: report.errors ?? [] };
}

/**
 * `task` on every item, at most `limit` in flight; results in item order.
 *
 * @template T, R
 * @param {readonly T[]} items - The work.
 * @param {number} limit - The most tasks in flight at once.
 * @param {(item: T) => Promise<R>} task - One unit of work.
 * @returns {Promise<R[]>} One result per item, in item order.
 */
async function mapBounded(items, limit, task) {
  /** @type {R[]} */
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const at = next++;
      results[at] = await task(items[at]);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/**
 * Every pair judged, {@link GATE_CONCURRENCY} gate runs at a time, one fetch per URL.
 *
 * @param {readonly Pair[]} pairs - Every pair, in report order.
 * @param {WatchIo} io - Watch I/O.
 * @returns {Promise<WatchRow[]>} Rows in pair order.
 */
async function judgeAll(pairs, io) {
  const runIo = { ...io, fetch: { ...io.fetch, cache: new Map() } };
  return mapBounded(pairs, GATE_CONCURRENCY, pair => judge(pair, runIo));
}

/**
 * What the body says besides the pairs: date, platform, CI tag, range, repository.
 *
 * @param {Inputs} inputs - Everything the watch reads.
 * @param {WatchIo} io - Watch I/O.
 * @returns {{ checkedOn: string, platform: string, manifestTag: string, range: string, repo: string | undefined }}
 *   Header fields of the body.
 */
function headerOf(inputs, io) {
  const checkedOn = io.now().toISOString().slice(0, 10);
  const { platform } = inputs.check;
  const manifestTag = inputs.manifest.camoufox.tag;
  const range = inputs.range.text;
  return { checkedOn, platform, manifestTag, range, repo: io.env.GITHUB_REPOSITORY };
}

/** The issue body for the current upstream state. */
async function watchBody(/** @type {WatchIo} */ io) {
  const inputs = await readInputs(io);
  const selected = selectRelease(inputs.releases, inputs.check.acceptsAsset);
  const rows = await judgeAll(pairsOf(inputs, selected), io);
  return renderWatch({ ...headerOf(inputs, io), selected, rows });
}

/** Whether `error` means the watch cannot read its inputs. */
const isInfra = (/** @type {unknown} */ error) =>
  error instanceof GateInfraError || error instanceof FetchFailedError;

/** @type {(error: GateInfraError | FetchFailedError) => string[]} The lines that report an input failure. */
const infraLines = error =>
  error instanceof GateInfraError ? error.lines : [`FETCH-FAILED ${error.message}`];

/**
 * Print the body, and write it to `--out` when given.
 *
 * @param {readonly string[]} args - CLI arguments after the script path.
 * @param {WatchIo} io - Watch I/O.
 * @returns {Promise<0>} Exit code: the report is written, whatever it finds.
 */
async function writeReport(args, io) {
  const { out } = parseWatchArgs(args);
  const body = await watchBody(io);
  io.stdout(body);
  if (out !== undefined) io.writeFile(out, body);
  return 0;
}

/**
 * Run the watch once.
 *
 * @param {readonly string[]} args - CLI arguments after the script path.
 * @param {IWatchIo} [overrides] - Test I/O.
 * @returns {Promise<0 | 2>} Exit code.
 * @throws {Error} Only on a bug: anything that is not an input failure.
 */
export async function runWatch(args, overrides = {}) {
  const io = { ...DEFAULT_IO, ...overrides };
  try {
    return await writeReport(args, io);
  } catch (error) {
    if (!isInfra(error)) throw error;
    io.stderr(`${infraLines(error).join('\n')}\n`);
    return 2;
  }
}
