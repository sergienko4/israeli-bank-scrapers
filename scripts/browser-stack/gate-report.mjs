/**
 * Verdict and text output of one browser-stack gate run.
 *
 * `gate` (PR CI, `npm run lint:browser-stack`) fails on any NEW, STALE or
 * DRIFT finding, and stops with DIGEST-MISMATCH (exit 2) when a fetched
 * `Protocol.js` is not the pinned one. `candidate` ("could this pair work?")
 * fails on NEW only and prints STALE, DRIFT and MISMATCH marked `[info]`.
 * UNPINNED — no pin covers a side — is `[info]` in both modes.
 */

/** @typedef {import('./juggler-diff.d.mts').IJugglerDelta} IJugglerDelta */

/**
 * How a fetched `Protocol.js` compares with its pin in `browser-stack.json`.
 *
 * @typedef {'match' | 'unpinned' | 'mismatch'} PinState
 */

/**
 * One gate run: the pair under test, both sha256 values, every finding and the verdict.
 *
 * @typedef {object} Report
 * @property {string} playwright - playwright-core version under test.
 * @property {string} camoufox - Camoufox tag under test.
 * @property {string} mode - `--mode`, one of {@link MODE_NAMES}.
 * @property {string} testedMinor - playwright-core minor of `browser-stack.json`.
 * @property {{ client: string, browser: string }} sha256 - sha256 of both `Protocol.js` bodies.
 * @property {{ client: PinState, browser: PinState }} pins - Each body against its pin.
 * @property {IJugglerDelta[]} new - Deltas the manifest does not accept.
 * @property {IJugglerDelta[]} stale - Accepted deltas no longer found.
 * @property {IJugglerDelta[]} accepted - Accepted deltas still found.
 * @property {boolean} drift - Whether the playwright-core minor differs from `testedMinor`.
 * @property {0 | 1} exit - 1 when a finding fails the mode, else 0.
 */

/** @typedef {Pick<Report, 'new' | 'stale' | 'drift'>} Findings - What a verdict reads. */

/** Per mode: which findings fail the run, whether a digest mismatch stops it, the info mark. */
const MODES = Object.freeze({
  gate: Object.freeze({
    failsOn: (/** @type {Findings} */ r) => r.new.length > 0 || r.stale.length > 0 || r.drift,
    stopsOnMismatch: true,
    infoMark: '',
  }),
  candidate: Object.freeze({
    failsOn: (/** @type {Findings} */ r) => r.new.length > 0,
    stopsOnMismatch: false,
    infoMark: ' [info]',
  }),
});

/** Every accepted `--mode` value. */
export const MODE_NAMES = Object.freeze(Object.keys(MODES));

/** Mark of a line that never changes the verdict, in any mode. */
const ADVISORY = ' [info]';

/** @type {(version: string) => string} `major.minor` of an `x.y.z` version. */
export const minorOf = version => version.split('.').slice(0, 2).join('.');

/** @type {(mode: string) => boolean} Whether a digest mismatch stops a run of `mode`. */
export const stopsOnMismatch = mode => MODES[/** @type {'gate'} */ (mode)].stopsOnMismatch;

/**
 * One side of the pair, named for a report line.
 *
 * @param {Pick<Report, 'playwright' | 'camoufox'>} pair - The pair under test.
 * @param {'client' | 'browser'} side - Which `Protocol.js`.
 * @returns {string} `client playwright-core <version>` or `browser Camoufox <tag>`.
 */
export function sideName(pair, side) {
  return side === 'client'
    ? `client playwright-core ${pair.playwright}`
    : `browser Camoufox ${pair.camoufox}`;
}

/**
 * Exit code of a report: 1 when a finding fails its mode, else 0.
 *
 * @param {Pick<Report, 'mode' | 'new' | 'stale' | 'drift'>} report - Findings.
 * @returns {0 | 1} Exit code.
 */
export function exitOf(report) {
  return MODES[/** @type {'gate'} */ (report.mode)].failsOn(report) ? 1 : 0;
}

/** @type {(label: string, text: string) => string} A row under a fixed-width label. */
const row = (label, text) => `${label.padEnd(10)}${text}`;

/** @type {(d: IJugglerDelta) => string} Channel, kind and path of a delta, aligned. */
const cells = d => `${d.channel.padEnd(8)}${d.kind.padEnd(23)}${d.path}`;

/** @type {(r: Report) => string} The DRIFT finding text. */
const driftText = r =>
  `playwright-core minor ${minorOf(r.playwright)} ≠ testedMinor ${r.testedMinor}` +
  ' (bump testedMinor only after the contract test passes)';

/** Text of a pin row, by state; a matching pin prints no row. */
const PIN_TEXTS = Object.freeze({
  unpinned: Object.freeze(['UNPINNED', 'browser-stack.json pins no Protocol.js sha256']),
  mismatch: Object.freeze(['MISMATCH', 'Protocol.js sha256 differs from its pin']),
});

/** Pin rows: one per side whose `Protocol.js` is unpinned or, in candidate mode, moved. */
function pinRows(/** @type {Report} */ r) {
  const sides = /** @type {const} */ (['client', 'browser']);
  return sides.flatMap(side => {
    const state = r.pins[side];
    if (state === 'match') return [];
    const [label, text] = PIN_TEXTS[state];
    return [row(label, `${sideName(r, side)}: ${text}${ADVISORY}`)];
  });
}

/** Finding rows: NEW and STALE carry the signature a manifest edit needs. */
function findingRows(/** @type {Report} */ r) {
  const mark = MODES[/** @type {'gate'} */ (r.mode)].infoMark;
  return [
    ...pinRows(r),
    ...r.new.map(d => row('NEW', `${cells(d)}  ${d.signature}`)),
    ...r.stale.map(d => row('STALE', `${cells(d)}  ${d.signature}${mark}`)),
    ...(r.drift ? [row('DRIFT', `${driftText(r)}${mark}`)] : []),
    ...r.accepted.map(d => row('ACCEPTED', cells(d))),
  ];
}

/** @type {(r: Report) => string} Verdict and counts. */
const summary = r =>
  `${r.exit === 0 ? 'PASS' : 'FAIL'}: ${r.new.length} new, ${r.stale.length} stale, ` +
  `${r.accepted.length} accepted${r.drift ? ', drift' : ''}`;

/**
 * Human-readable report: pair, both sha256 values, every finding, verdict.
 *
 * @param {Report} r - Report with its exit code.
 * @returns {string} Text ending in a newline.
 */
export function renderText(r) {
  const title = `browser-stack: playwright-core ${r.playwright} × Camoufox ${r.camoufox}`;
  const hashes = `  client sha256=${r.sha256.client}  browser sha256=${r.sha256.browser}`;
  const lines = [`${title} (mode=${r.mode})`, hashes, ...findingRows(r), summary(r)];
  return `${lines.join('\n')}\n`;
}
