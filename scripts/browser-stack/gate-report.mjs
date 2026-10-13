/**
 * Verdict and text output of one browser-stack gate run.
 *
 * `gate` (PR CI, `npm run lint:browser-stack`) fails on any NEW, STALE or
 * DRIFT finding. `candidate` ("could this pair work?") fails on NEW only and
 * prints STALE and DRIFT marked `[info]`.
 */

/** Per mode: which findings fail the run, and the mark on informational lines. */
const MODES = Object.freeze({
  gate: Object.freeze({
    failsOn: (/** @type {any} */ r) => r.new.length > 0 || r.stale.length > 0 || r.drift,
    infoMark: '',
  }),
  candidate: Object.freeze({
    failsOn: (/** @type {any} */ r) => r.new.length > 0,
    infoMark: ' [info]',
  }),
});

/** Every accepted `--mode` value. */
export const MODE_NAMES = Object.freeze(Object.keys(MODES));

/** @type {(version: string) => string} `major.minor` of an `x.y.z` version. */
export const minorOf = version => version.split('.').slice(0, 2).join('.');

/**
 * Exit code of a report: 1 when a finding fails its mode, else 0.
 *
 * @param {{ mode: string, new: unknown[], stale: unknown[], drift: boolean }} report - Findings.
 * @returns {0 | 1} Exit code.
 */
export function exitOf(report) {
  return MODES[/** @type {'gate'} */ (report.mode)].failsOn(report) ? 1 : 0;
}

/** @type {(label: string, text: string) => string} A row under a fixed-width label. */
const row = (label, text) => `${label.padEnd(10)}${text}`;

/** @type {(d: any) => string} Channel, kind and path of a delta, aligned. */
const cells = d => `${d.channel.padEnd(8)}${d.kind.padEnd(23)}${d.path}`;

/** @type {(r: any) => string} The DRIFT finding text. */
const driftText = r =>
  `playwright-core minor ${minorOf(r.playwright)} ≠ testedMinor ${r.testedMinor}` +
  ' (bump testedMinor only after the contract test passes)';

/** Finding rows: NEW and STALE carry the signature a manifest edit needs. */
function findingRows(/** @type {any} */ r) {
  const mark = MODES[/** @type {'gate'} */ (r.mode)].infoMark;
  return [
    ...r.new.map((/** @type {any} */ d) => row('NEW', `${cells(d)}  ${d.signature}`)),
    ...r.stale.map((/** @type {any} */ d) => row('STALE', `${cells(d)}  ${d.signature}${mark}`)),
    ...(r.drift ? [row('DRIFT', `${driftText(r)}${mark}`)] : []),
    ...r.accepted.map((/** @type {any} */ d) => row('ACCEPTED', cells(d))),
  ];
}

/** @type {(r: any) => string} Verdict and counts. */
const summary = r =>
  `${r.exit === 0 ? 'PASS' : 'FAIL'}: ${r.new.length} new, ${r.stale.length} stale, ` +
  `${r.accepted.length} accepted${r.drift ? ', drift' : ''}`;

/**
 * Human-readable report: pair, both sha256 values, every finding, verdict.
 *
 * @param {any} r - Report with its exit code.
 * @returns {string} Text ending in a newline.
 */
export function renderText(r) {
  const title = `browser-stack: playwright-core ${r.playwright} × Camoufox ${r.camoufox}`;
  const hashes = `  client sha256=${r.sha256.client}  browser sha256=${r.sha256.browser}`;
  const lines = [`${title} (mode=${r.mode})`, hashes, ...findingRows(r), summary(r)];
  return `${lines.join('\n')}\n`;
}
