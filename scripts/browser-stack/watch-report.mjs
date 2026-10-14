/**
 * Markdown body of the weekly browser-stack watch issue.
 *
 * Three sections:
 * - the consumer pair — what the library's own playwright-core range resolves
 *   to × the release camoufox-js installs — and whether the gate finds it
 *   compatible;
 * - CI drift — whether CI's tested Camoufox tag is the one camoufox-js installs;
 * - every candidate pair, with `selected-compatible` = compatible ∧ selected.
 *
 * Compatible means the gate (`--mode candidate`) found no unaccepted Juggler
 * delta. It never means landable: only the coupled bump, with its contract
 * and E2E tests, proves a pair works.
 */
import { rangeLabel } from './playwright-versions.mjs';

/**
 * @typedef {'compatible' | 'new' | 'unknown'} Verdict - The gate's verdict on one pair.
 *
 * @typedef {object} WatchRow - One judged candidate pair.
 * @property {string} playwright - playwright-core version.
 * @property {readonly string[]} labels - Why the version is a candidate.
 * @property {string} tag - Camoufox release tag.
 * @property {boolean} prerelease - Whether the release is a prerelease.
 * @property {boolean} selected - Whether camoufox-js installs the release.
 * @property {Verdict} verdict - The gate's verdict.
 * @property {readonly string[]} newPaths - Paths of the NEW deltas.
 * @property {readonly string[]} errors - Why the gate could not decide, if it could not.
 *
 * @typedef {object} Watch - Everything the issue body reports.
 * @property {string} checkedOn - `yyyy-mm-dd`.
 * @property {string} platform - The platform camoufox-js checks assets for.
 * @property {string} manifestTag - The Camoufox tag CI installs.
 * @property {string} range - The library's own playwright-core range.
 * @property {string | null} selected - The tag camoufox-js installs, or `null` when none.
 * @property {readonly WatchRow[]} rows - Every judged pair.
 * @property {string | undefined} repo - `owner/name`, for the update-PR search.
 */

/** How many NEW paths are shown before "N more". */
const SHOWN_PATHS = 3;

/** Verdict text and table cell per gate verdict. */
const VERDICTS = Object.freeze({
  compatible: Object.freeze({ text: 'compatible', cell: 'yes' }),
  new: Object.freeze({ text: 'not compatible', cell: 'no' }),
  unknown: Object.freeze({ text: 'unknown (the gate could not decide)', cell: 'unknown' }),
});

const INTRO =
  'Compatible means the browser-stack gate (`--mode candidate`) found no unaccepted' +
  ' Juggler delta. It does not mean landable: only the coupled bump, with its contract' +
  ' and E2E tests, proves that.';

const TABLE_HEAD = [
  '| playwright-core | Camoufox | prerelease | selected | NEW | compatible | selected-compatible |',
  '| --- | --- | --- | --- | --- | --- | --- |',
];

/** @type {(flag: boolean) => string} */
const yesNo = flag => (flag ? 'yes' : 'no');

/** @type {(text: string) => string} */
const code = text => `\`${text}\``;

/** @type {(row: WatchRow) => { text: string, cell: string }} */
const verdictOf = row => VERDICTS[row.verdict];

/** NEW paths: the first {@link SHOWN_PATHS}, then how many more. */
function pathList(/** @type {readonly string[]} */ paths) {
  const shown = paths.slice(0, SHOWN_PATHS).map(code);
  const hidden = paths.length - shown.length;
  return [...shown, ...(hidden > 0 ? [`${hidden} more`] : [])].join(', ');
}

/** @type {(row: WatchRow) => string} NEW cell: the count, then the paths. */
const newCell = row =>
  row.verdict === 'unknown'
    ? '—'
    : [String(row.newPaths.length), pathList(row.newPaths)].filter(Boolean).join(': ');

/** @type {(row: WatchRow) => string[]} The cells of one candidate row. */
const rowCells = row => [
  `${row.playwright} (${row.labels.join(', ')})`,
  code(row.tag),
  yesNo(row.prerelease),
  yesNo(row.selected),
  newCell(row),
  verdictOf(row).cell,
  yesNo(row.verdict === 'compatible' && row.selected),
];

/** @type {(row: WatchRow) => string} One candidate table row. */
const tableRow = row => `| ${rowCells(row).join(' | ')} |`;

/** @type {(platform: string) => string} */
const noRelease = platform =>
  `camoufox-js finds no stable release with a ${platform} asset on the first releases` +
  ' page: a consumer install fails.';

/** @type {(pair: WatchRow, range: string) => string} The consumer pair and its verdict. */
const pairLine = (pair, range) =>
  `playwright-core ${code(pair.playwright)} (what a consumer's ${code(range)} resolves to)` +
  ` × Camoufox ${code(pair.tag)} (what camoufox-js installs): **${verdictOf(pair).text}**` +
  `${pair.newPaths.length > 0 ? ` — NEW: ${pathList(pair.newPaths)}` : ''}.`;

/** The pair a consumer install gets today, or why there is none. */
function consumerSection(/** @type {Watch} */ watch) {
  if (watch.selected === null) return noRelease(watch.platform);
  const label = rangeLabel(watch.range);
  const pair = watch.rows.find(r => r.selected && r.labels.includes(label));
  if (pair !== undefined) return pairLine(pair, watch.range);
  return (
    `No stable playwright-core version satisfies ${code(watch.range)}` +
    ` to pair with ${code(watch.selected)}.`
  );
}

/** Whether CI tests the release camoufox-js installs. */
function driftSection(/** @type {Watch} */ watch) {
  const ci = `CI installs Camoufox ${code(watch.manifestTag)} (\`browser-stack.json\`)`;
  const tag = watch.selected === null ? 'none' : code(watch.selected);
  const status = watch.selected === watch.manifestTag ? 'in step' : 'drift';
  return `${ci}; camoufox-js installs ${tag}: **${status}**.`;
}

/** @type {(row: WatchRow) => string[]} One line per gate error of an undecided pair. */
const errorLines = row =>
  row.verdict === 'unknown'
    ? row.errors.map(e => `- ${row.playwright} × ${code(row.tag)}: ${e}`)
    : [];

/** The candidate table, then the errors of any pair the gate could not decide. */
function candidateSection(/** @type {Watch} */ watch) {
  const errors = watch.rows.flatMap(errorLines);
  const notes = errors.length > 0 ? ['', 'The gate could not decide:', ...errors] : [];
  return [...TABLE_HEAD, ...watch.rows.map(tableRow), ...notes].join('\n');
}

/**
 * Section titles and renderers, in body order.
 *
 * @type {readonly (readonly [string, (watch: Watch) => string])[]}
 */
const SECTIONS = Object.freeze([
  ['Consumer pair', consumerSection],
  ['CI drift', driftSection],
  ['Candidates', candidateSection],
]);

/** @type {(repo: string | undefined) => string[]} A search for open playwright-core update PRs. */
const prLink = repo =>
  repo
    ? [
        '',
        `Open playwright-core updates: https://github.com/${repo}/pulls?q=is%3Apr+is%3Aopen+playwright-core`,
      ]
    : [];

/**
 * The issue body.
 *
 * @param {Watch} watch - What the body reports.
 * @returns {string} Markdown ending in a newline.
 */
export function renderWatch(watch) {
  const intro = ['## Browser-stack watch', '', `Checked ${watch.checkedOn} on ${watch.platform}.`];
  const sections = SECTIONS.flatMap(([title, render]) => [
    '',
    `### ${title}`,
    '',
    render(watch),
  ]);
  return `${[...intro, '', INTRO, ...sections, ...prLink(watch.repo)].join('\n')}\n`;
}
