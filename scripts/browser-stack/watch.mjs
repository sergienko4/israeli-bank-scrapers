/**
 * Weekly browser-stack watch: which playwright-core × Camoufox pairs could work?
 *
 * Reads the Camoufox releases page camoufox-js reads and the playwright-core
 * packument, then runs the browser-stack gate in `candidate` mode, with
 * `--json`, on every candidate version × candidate release. The release
 * camoufox-js installs is always among the pairs. The result is the markdown
 * body of one issue (see watch-report.mjs), printed and optionally written to
 * `--out <file>`.
 *
 * Exit codes: 0 report written, whatever it finds · 2 the watch cannot read
 * its inputs (USAGE, MANIFEST-INVALID, LOCKFILE-INVALID, FETCH-FAILED).
 * A pair the gate cannot decide is reported as unknown, not a failure.
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
import { fetchPackument, playwrightCandidates } from './playwright-versions.mjs';
import { renderWatch } from './watch-report.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Production I/O; tests override any member. */
const DEFAULT_IO = Object.freeze({
  manifestPath: `${ROOT}browser-stack.json`,
  lockfilePath: `${ROOT}package-lock.json`,
  env: process.env,
  fetch: {},
  assetCheck: platformAssetCheck,
  runGate,
  now: () => new Date(),
  writeFile: (/** @type {string} */ path, /** @type {string} */ text) => writeFileSync(path, text),
  stdout: (/** @type {string} */ text) => process.stdout.write(text),
  stderr: (/** @type {string} */ text) => process.stderr.write(text),
});

/** Gate verdict per gate exit code. */
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

/** Manifest, lockfile version, releases page, packument and asset check. */
async function readInputs(/** @type {any} */ io) {
  const manifest = readManifest(io.manifestPath);
  const locked = lockedPlaywright(io.lockfilePath);
  const reading = [fetchReleases(io.env, io.fetch), fetchPackument(io.fetch), io.assetCheck()];
  const [releases, packument, check] = await Promise.all(reading);
  return { manifest, locked, releases, packument, check };
}

/** Candidate releases, plus the selected one when it is not among them; it is marked. */
function releaseRows(/** @type {any[]} */ releases, /** @type {string | null} */ selected) {
  const rows = candidateReleases(releases);
  const listed = selected === null || rows.some(r => r.tag === selected);
  const all = listed ? rows : [...rows, { tag: selected, prerelease: false }];
  return all.map(r => ({ ...r, selected: r.tag === selected }));
}

/** Every candidate version × release, the selected release marked. */
function pairsOf(/** @type {any} */ inputs, /** @type {string | null} */ selected) {
  const { manifest, locked, releases, packument } = inputs;
  const versions = playwrightCandidates(packument, locked, manifest.playwrightCore.testedMinor);
  const tags = releaseRows(releases, selected);
  return versions.flatMap(v => tags.map(t => ({ playwright: v.version, labels: v.labels, ...t })));
}

/** @type {(pair: any) => string[]} The gate arguments for one pair. */
const gateArgs = pair => [
  '--playwright',
  pair.playwright,
  '--camoufox',
  pair.tag,
  ...CANDIDATE_JSON,
];

/** The gate's JSON report on one pair, run in candidate mode. */
async function gateReport(/** @type {any} */ pair, /** @type {any} */ io) {
  let out = '';
  const capture = (/** @type {string} */ text) => ((out += text), true);
  const paths = { manifestPath: io.manifestPath, lockfilePath: io.lockfilePath };
  const gateIo = { ...paths, fetch: io.fetch, stdout: capture, stderr: () => true };
  const exit = await io.runGate(gateArgs(pair), gateIo);
  return { exit, report: JSON.parse(out.trim().split('\n').at(-1) ?? '') };
}

/** One pair with its verdict, NEW paths and gate errors. */
async function judge(/** @type {any} */ pair, /** @type {any} */ io) {
  const { exit, report } = await gateReport(pair, io);
  const newPaths = (report.new ?? []).map((/** @type {any} */ d) => d.path);
  return { ...pair, verdict: VERDICTS[exit], newPaths, errors: report.errors ?? [] };
}

/** Every pair judged, one gate run at a time. */
async function judgeAll(/** @type {any[]} */ pairs, /** @type {any} */ io) {
  const rows = [];
  for (const pair of pairs) rows.push(await judge(pair, io));
  return rows;
}

/** What the body says besides the pairs: date, platform, CI tag, repository. */
function headerOf(/** @type {any} */ inputs, /** @type {any} */ io) {
  const checkedOn = io.now().toISOString().slice(0, 10);
  const { platform } = inputs.check;
  const manifestTag = inputs.manifest.camoufox.tag;
  return { checkedOn, platform, manifestTag, repo: io.env.GITHUB_REPOSITORY };
}

/** The issue body for the current upstream state. */
async function watchBody(/** @type {any} */ io) {
  const inputs = await readInputs(io);
  const selected = selectRelease(inputs.releases, inputs.check.acceptsAsset);
  const rows = await judgeAll(pairsOf(inputs, selected), io);
  return renderWatch({ ...headerOf(inputs, io), selected, rows });
}

/** Whether `error` means the watch cannot read its inputs. */
const isInfra = (/** @type {unknown} */ error) =>
  error instanceof GateInfraError || error instanceof FetchFailedError;

/** @type {(error: any) => string[]} The lines that report an input failure. */
const infraLines = error =>
  error instanceof GateInfraError ? error.lines : [`FETCH-FAILED ${error.message}`];

/** Print the body, and write it to `--out` when given. */
async function writeReport(/** @type {readonly string[]} */ args, /** @type {any} */ io) {
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
 * @param {object} [overrides] - Test I/O.
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
