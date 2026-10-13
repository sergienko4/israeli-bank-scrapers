/**
 * Browser-stack gate: can playwright-core `x.y.z` drive Camoufox `<tag>`?
 *
 * Fetches both Juggler `Protocol.js` files, diffs them directionally and
 * subtracts the accepted deltas of `browser-stack.json` by identity
 * `(channel, kind, path, signature)`:
 *
 * - NEW — a delta the manifest does not accept;
 * - STALE — an accepted delta no longer found: fixed upstream, or its type
 *   signature changed (the changed delta is then NEW as well);
 * - DRIFT — the playwright-core minor differs from `testedMinor`;
 * - GENERATED-STALE — `src/Common/Config/BrowserStackConfig.ts` is not what
 *   `npm run browser-stack:gen` would write from the manifest.
 *
 * Both bodies are checked against their pinned sha256 before either is parsed
 * (see gate-pins.mjs).
 *
 * Exit codes (closed set): 0 pass · 1 a finding fails the mode (see
 * gate-report.mjs) · 2 the gate cannot decide: USAGE, MANIFEST-INVALID,
 * LOCKFILE-INVALID (see gate-inputs.mjs), FETCH-FAILED, DIGEST-MISMATCH (gate
 * mode) or UNPARSEABLE.
 */
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { FetchFailedError, fetchFirst, fetchProtocol, protocolUrls } from './fetch-protocol.mjs';
import { GateInfraError, lockedPlaywright, parseCli, readManifest } from './gate-inputs.mjs';
import { checkPins } from './gate-pins.mjs';
import { GENERATED_PATH, isGeneratedStale } from './gen-config.mjs';
import { exitOf, minorOf, renderText } from './gate-report.mjs';
import { diffSchemas } from './juggler-diff.mjs';
import { parseJugglerSchema, UnparseableSchemaError } from './juggler-schema.mjs';

/**
 * @typedef {import('./gate.d.mts').IFetchIo} IFetchIo
 * @typedef {import('./gate.d.mts').IGateIo} IGateIo
 * @typedef {Required<IGateIo>} GateIo - Gate I/O, defaults filled in.
 * @typedef {import('./gate-inputs.mjs').AcceptedDelta} AcceptedDelta
 * @typedef {import('./gate-inputs.mjs').CliOptions} CliOptions
 * @typedef {import('./gate-pins.mjs').Pair} Pair
 * @typedef {import('./gate-report.mjs').Report} Report
 * @typedef {import('./juggler-diff.d.mts').IJugglerDelta} IJugglerDelta
 * @typedef {{ text: string, sha256: string }} Body - One fetched `Protocol.js`.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Production I/O; tests override any member. */
const DEFAULT_IO = Object.freeze({
  manifestPath: `${ROOT}browser-stack.json`,
  lockfilePath: `${ROOT}package-lock.json`,
  generatedPath: GENERATED_PATH,
  fetch: {},
  stdout: (/** @type {string} */ text) => process.stdout.write(text),
  stderr: (/** @type {string} */ text) => process.stderr.write(text),
});

/**
 * Both bodies. Waits for both fetches, so every failure is reported and none is left pending.
 *
 * @param {{ client: string, browser: string[] }} urls - Client URL; browser candidates.
 * @param {IFetchIo} io - Fetch I/O overrides.
 * @returns {Promise<Body[]>} Client, then browser.
 */
async function fetchBoth(urls, io) {
  const runs = [fetchProtocol(urls.client, io), fetchFirst(urls.browser, io)];
  const settled = await Promise.allSettled(runs);
  const failures = settled.flatMap(s => (s.status === 'rejected' ? [s.reason] : []));
  if (failures.length === 0)
    return settled.map(s => /** @type {PromiseFulfilledResult<Body>} */ (s).value);
  const unexpected = failures.find(f => !(f instanceof FetchFailedError));
  throw unexpected ?? new GateInfraError(failures.map(f => `FETCH-FAILED ${f.message}`));
}

/** Normalized schema of one side, or UNPARSEABLE naming the side and line. */
function parseSide(/** @type {string} */ side, /** @type {string} */ text) {
  try {
    return parseJugglerSchema(text);
  } catch (error) {
    if (!(error instanceof UnparseableSchemaError)) throw error;
    throw new GateInfraError([`UNPARSEABLE ${side} ${error.message}`]);
  }
}

/** @type {(d: IJugglerDelta) => string} Identity of a delta or accepted entry. */
const identity = d => JSON.stringify([d.channel, d.kind, d.path, d.signature]);

/** Deltas the manifest does not accept, accepted entries not found, and those found. */
function classify(
  /** @type {readonly IJugglerDelta[]} */ deltas,
  /** @type {readonly AcceptedDelta[]} */ accepted,
) {
  const found = new Set(deltas.map(identity));
  const known = new Set(accepted.map(identity));
  const fresh = deltas.filter(d => !known.has(identity(d)));
  const stale = accepted.filter(a => !found.has(identity(a)));
  return { new: fresh, stale, accepted: accepted.filter(a => found.has(identity(a))) };
}

/** Manifest, and the pair under test: options win, else lockfile and manifest. */
function resolvePair(/** @type {CliOptions} */ options, /** @type {GateIo} */ io) {
  const manifest = readManifest(io.manifestPath);
  const playwright = options.playwright ?? lockedPlaywright(io.lockfilePath);
  return { manifest, playwright, camoufox: options.camoufox ?? manifest.camoufox.tag };
}

/**
 * sha256 of both sources, each against its pin, and every delta between them.
 *
 * @param {Pair} pair - Manifest and the pair under test.
 * @param {string} mode - `--mode`; decides whether a pin mismatch stops the run.
 * @param {IFetchIo} io - Fetch I/O overrides.
 * @returns {Promise<Pick<Report, 'sha256' | 'pins'> & { deltas: IJugglerDelta[] }>} Comparison.
 */
async function compare(pair, mode, io) {
  const urls = protocolUrls(pair.playwright, pair.camoufox);
  const [client, browser] = await fetchBoth(urls, io);
  const sha256 = { client: client.sha256, browser: browser.sha256 };
  const pins = checkPins(pair, mode, sha256);
  const deltas = diffSchemas(parseSide('client', client.text), parseSide('browser', browser.text));
  return { sha256, pins, deltas };
}

/** Findings that need no network: DRIFT and GENERATED-STALE. */
function localFindings(
  /** @type {any} */ manifest,
  /** @type {string} */ playwright,
  /** @type {string} */ generatedPath,
) {
  const drift = minorOf(playwright) !== manifest.playwrightCore.testedMinor;
  return { drift, generatedStale: isGeneratedStale(manifest, generatedPath) };
}

/** The full report of one run, exit code included. */
async function evaluate(/** @type {CliOptions} */ options, /** @type {GateIo} */ io) {
  const pair = resolvePair(options, io);
  const { manifest, playwright, camoufox } = pair;
  const { sha256, pins, deltas } = await compare(pair, options.mode, io.fetch);
  const { testedMinor } = manifest.playwrightCore;
  const local = localFindings(manifest, playwright, io.generatedPath);
  const found = classify(deltas, manifest.acceptedDeltas);
  const head = { playwright, camoufox, mode: options.mode, testedMinor, sha256, pins };
  const report = { ...head, ...found, ...local };
  return { ...report, exit: exitOf(report) };
}

/**
 * Print an infrastructure failure: lines to stderr, plus JSON on stdout under `--json`.
 *
 * @param {GateInfraError} error - What stopped the gate.
 * @param {boolean} json - Whether `--json` was given.
 * @param {Pick<GateIo, 'stdout' | 'stderr'>} io - Output sinks.
 * @returns {2} Exit code.
 */
function reportInfra(error, json, io) {
  io.stderr(`${error.lines.join('\n')}\n`);
  if (json) io.stdout(`${JSON.stringify({ exit: 2, errors: error.lines })}\n`);
  return 2;
}

/**
 * Evaluate and print one report.
 *
 * @param {readonly string[]} args - CLI arguments.
 * @param {GateIo} io - Full I/O.
 * @param {boolean} json - Whether `--json` was given.
 * @returns {Promise<0 | 1>} Exit code of the report.
 */
async function decide(args, io, json) {
  const report = await evaluate(parseCli(args), io);
  io.stdout(json ? `${JSON.stringify(report)}\n` : renderText(report));
  return report.exit;
}

/**
 * Run the gate once.
 *
 * @param {readonly string[]} args - CLI arguments after the script path.
 * @param {IGateIo} [overrides] - Test I/O: paths, fetch options, output sinks.
 * @returns {Promise<0 | 1 | 2>} Exit code.
 * @throws {Error} Only on a bug: anything that is not a {@link GateInfraError}.
 */
export async function runGate(args, overrides = {}) {
  const io = { ...DEFAULT_IO, ...overrides };
  const json = args.includes('--json');
  try {
    return await decide(args, io, json);
  } catch (error) {
    if (error instanceof GateInfraError) return reportInfra(error, json, io);
    throw error;
  }
}
