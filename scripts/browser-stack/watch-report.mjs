/**
 * Markdown body of the weekly browser-stack watch issue.
 *
 * Three sections:
 * - the consumer pair — npm `latest` × the release camoufox-js installs —
 *   and whether the gate finds it compatible;
 * - CI drift — whether CI's tested Camoufox tag is the one camoufox-js installs;
 * - every candidate pair, with `selected-compatible` = compatible ∧ selected.
 *
 * Compatible means the gate (`--mode candidate`) found no unaccepted Juggler
 * delta. It never means landable: only the coupled bump, with its contract
 * and E2E tests, proves a pair works.
 */

/** How many NEW paths are shown before "N more". */
const SHOWN_PATHS = 3;

/** The row label of npm `latest`, as `playwright-versions.mjs` writes it. */
const LATEST_LABEL = 'npm latest';

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

/** @type {(row: any) => { text: string, cell: string }} */
const verdictOf = row => VERDICTS[/** @type {'new'} */ (row.verdict)];

/** NEW paths: the first {@link SHOWN_PATHS}, then how many more. */
function pathList(/** @type {readonly string[]} */ paths) {
  const shown = paths.slice(0, SHOWN_PATHS).map(code);
  const hidden = paths.length - shown.length;
  return [...shown, ...(hidden > 0 ? [`${hidden} more`] : [])].join(', ');
}

/** @type {(row: any) => string} NEW cell: the count, then the paths. */
const newCell = row =>
  row.verdict === 'unknown'
    ? '—'
    : [String(row.newPaths.length), pathList(row.newPaths)].filter(Boolean).join(': ');

/** @type {(row: any) => string[]} The cells of one candidate row. */
const rowCells = row => [
  `${row.playwright} (${row.labels.join(', ')})`,
  code(row.tag),
  yesNo(row.prerelease),
  yesNo(row.selected),
  newCell(row),
  verdictOf(row).cell,
  yesNo(row.verdict === 'compatible' && row.selected),
];

/** @type {(row: any) => string} One candidate table row. */
const tableRow = row => `| ${rowCells(row).join(' | ')} |`;

/** @type {(platform: string) => string} */
const noRelease = platform =>
  `camoufox-js finds no stable release with a ${platform} asset on the first releases` +
  ' page: a consumer install fails.';

/** @type {(pair: any) => string} The consumer pair and its verdict. */
const pairLine = pair =>
  `playwright-core ${code(pair.playwright)} (npm \`latest\`, what a \`^\` range resolves to)` +
  ` × Camoufox ${code(pair.tag)} (what camoufox-js installs): **${verdictOf(pair).text}**` +
  `${pair.newPaths.length > 0 ? ` — NEW: ${pathList(pair.newPaths)}` : ''}.`;

/** The pair a consumer install gets today, or why there is none. */
function consumerSection(/** @type {any} */ watch) {
  if (watch.selected === null) return noRelease(watch.platform);
  const pair = watch.rows.find(
    (/** @type {any} */ r) => r.selected && r.labels.includes(LATEST_LABEL),
  );
  if (pair !== undefined) return pairLine(pair);
  return `No stable npm \`latest\` of playwright-core to pair with ${code(watch.selected)}.`;
}

/** Whether CI tests the release camoufox-js installs. */
function driftSection(/** @type {any} */ watch) {
  const ci = `CI installs Camoufox ${code(watch.manifestTag)} (\`browser-stack.json\`)`;
  const tag = watch.selected === null ? 'none' : code(watch.selected);
  const status = watch.selected === watch.manifestTag ? 'in step' : 'drift';
  return `${ci}; camoufox-js installs ${tag}: **${status}**.`;
}

/** @type {(row: any) => string[]} One line per gate error of an undecided pair. */
const errorLines = row =>
  row.verdict === 'unknown'
    ? row.errors.map((/** @type {string} */ e) => `- ${row.playwright} × ${code(row.tag)}: ${e}`)
    : [];

/** The candidate table, then the errors of any pair the gate could not decide. */
function candidateSection(/** @type {any} */ watch) {
  const errors = watch.rows.flatMap(errorLines);
  const notes = errors.length > 0 ? ['', 'The gate could not decide:', ...errors] : [];
  return [...TABLE_HEAD, ...watch.rows.map(tableRow), ...notes].join('\n');
}

/** Section titles and renderers, in body order. */
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
 * @param {any} watch - `checkedOn`, `platform`, `manifestTag`, `selected`, `rows`, `repo`.
 * @returns {string} Markdown ending in a newline.
 */
export function renderWatch(watch) {
  const intro = ['## Browser-stack watch', '', `Checked ${watch.checkedOn} on ${watch.platform}.`];
  const sections = SECTIONS.flatMap(([title, render]) => [
    '',
    `### ${title}`,
    '',
    /** @type {(w: any) => string} */ (render)(watch),
  ]);
  return `${[...intro, '', INTRO, ...sections, ...prLink(watch.repo)].join('\n')}\n`;
}
