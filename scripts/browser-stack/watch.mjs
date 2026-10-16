/**
 * Weekly browser-stack watch: does the consumer pair pass the gate?
 *
 * A consumer install gets the playwright-core version the library's own
 * range resolves to and the Camoufox release camoufox-js installs; neither
 * moves through a PR here. The watch reads that range, the playwright-core
 * packument and the Camoufox releases page camoufox-js reads, then runs the
 * browser-stack gate once, in `candidate` mode with `--json`, on that pair.
 * The release is the one the lockfile's camoufox-js selects; a newer
 * camoufox-js in range arrives as its own Dependabot PR.
 * The result is the markdown body of one issue (see watch-report.mjs),
 * printed and optionally written to `--out <file>`.
 *
 * Exit codes: 0 report written, whatever it finds · 2 the watch cannot read
 * its inputs (USAGE, MANIFEST-INVALID, PACKAGE-INVALID, RANGE-UNSUPPORTED,
 * FETCH-FAILED). A pair the gate cannot decide is reported as unknown, not a
 * failure.
 */
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { fetchReleases, platformAssetCheck, selectRelease } from './camoufox-releases.mjs';
import { FetchFailedError } from './fetch-protocol.mjs';
import { runGate } from './gate.mjs';
import { GateInfraError, readManifest } from './gate-inputs.mjs';
import {
  caretRange,
  dependencyRange,
  fetchPackument,
  resolveRange,
} from './playwright-versions.mjs';
import { renderWatch } from './watch-report.mjs';

/**
 * @typedef {import('./camoufox-releases.d.mts').IRelease} IRelease
 * @typedef {import('./camoufox-releases.d.mts').IPlatformAssetCheck} IPlatformAssetCheck
 * @typedef {import('./gate-inputs.mjs').Manifest} Manifest
 * @typedef {import('./playwright-versions.d.mts').ICaretRange} ICaretRange
 * @typedef {import('./playwright-versions.d.mts').IPackument} IPackument
 * @typedef {import('./watch.d.mts').IWatchIo} IWatchIo
 * @typedef {import('./watch-report.mjs').Verdict} Verdict
 * @typedef {Omit<import('./watch-report.mjs').Watch, 'selected' | 'pair'>} Header - What the body says besides the pair.
 * @typedef {import('./watch-report.mjs').WatchPair} WatchPair
 * @typedef {Required<IWatchIo>} WatchIo - Watch I/O, defaults filled in.
 * @typedef {Pick<WatchPair, 'playwright' | 'tag'>} Pair - The consumer pair, not yet judged.
 *
 * @typedef {object} Inputs - Everything the watch reads before the gate runs.
 * @property {Manifest} manifest - `browser-stack.json`.
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

/** Production I/O; tests override any member. */
const DEFAULT_IO = Object.freeze({
  manifestPath: `${ROOT}browser-stack.json`,
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

/** How the pair is checked: as a candidate, the report as JSON. */
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
 * Manifest and range, read before any fetch; then releases page, packument and asset check.
 *
 * @param {WatchIo} io - Watch I/O.
 * @returns {Promise<Inputs>} Everything the watch reads.
 */
async function readInputs(io) {
  const manifest = readManifest(io.manifestPath);
  const range = caretRange(dependencyRange(io.packagePath));
  const reading = [fetchReleases(io.env, io.fetch), fetchPackument(io.fetch), io.assetCheck()];
  const [releases, packument, check] = await Promise.all(
    /** @type {[Promise<IRelease[]>, Promise<IPackument>, Promise<IPlatformAssetCheck>]} */ (
      reading
    ),
  );
  return { manifest, range, releases, packument, check };
}

/**
 * The consumer pair, or `null` when there is none.
 *
 * @param {Inputs} inputs - Everything the watch reads.
 * @param {string | null} selected - The tag camoufox-js installs, if any.
 * @returns {Pair | null} The range's version × the selected release.
 */
function consumerPair(inputs, selected) {
  const playwright = resolveRange(inputs.packument, inputs.range);
  if (selected === null || playwright === undefined) return null;
  return { playwright, tag: selected };
}

/** @type {(pair: Pair) => string[]} The gate arguments for the pair. */
const gateArgs = pair => [
  '--playwright',
  pair.playwright,
  '--camoufox',
  pair.tag,
  ...CANDIDATE_JSON,
];

/**
 * The gate's JSON report on the pair, run in candidate mode.
 *
 * @param {Pair} pair - The pair.
 * @param {WatchIo} io - Watch I/O.
 * @returns {Promise<{ exit: 0 | 1 | 2, report: GateJson }>} Gate exit code and report.
 */
async function gateReport(pair, io) {
  let out = '';
  const capture = (/** @type {string} */ text) => ((out += text), true);
  const gateIo = { manifestPath: io.manifestPath, fetch: io.fetch, stdout: capture };
  const exit = await io.runGate(gateArgs(pair), { ...gateIo, stderr: () => true });
  return { exit, report: JSON.parse(out.trim().split('\n').at(-1) ?? '') };
}

/**
 * The pair with its verdict, NEW paths and gate errors.
 *
 * @param {Pair} pair - The pair.
 * @param {WatchIo} io - Watch I/O.
 * @returns {Promise<WatchPair>} The judged pair.
 */
async function judge(pair, io) {
  const { exit, report } = await gateReport(pair, io);
  const newPaths = (report.new ?? []).map(d => d.path);
  return { ...pair, verdict: VERDICTS[exit], newPaths, errors: report.errors ?? [] };
}

/**
 * What the body says besides the pair: date, platform, CI tag, range, repository.
 *
 * @param {Inputs} inputs - Everything the watch reads.
 * @param {WatchIo} io - Watch I/O.
 * @returns {Header} Header fields of the body.
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
  const pair = consumerPair(inputs, selected);
  const judged = pair === null ? null : await judge(pair, io);
  return renderWatch({ ...headerOf(inputs, io), selected, pair: judged });
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
