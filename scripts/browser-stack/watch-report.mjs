/**
 * Markdown body of the weekly browser-stack watch issue.
 *
 * Two sections:
 * - the consumer pair — what the library's own playwright-core range resolves
 *   to × the release camoufox-js installs — and whether the gate finds it
 *   compatible, with its NEW paths or why the gate could not decide;
 * - CI drift — whether CI's tested Camoufox tag is the one camoufox-js installs.
 *
 * Compatible means the gate (`--mode candidate`) found no unaccepted Juggler
 * delta. It never means landable: only the coupled bump, with its contract
 * and E2E tests, proves a pair works.
 */

/**
 * @typedef {'compatible' | 'new' | 'unknown'} Verdict - The gate's verdict on the pair.
 *
 * @typedef {object} WatchPair - The judged consumer pair.
 * @property {string} playwright - playwright-core version.
 * @property {string} tag - Camoufox release tag.
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
 * @property {WatchPair | null} pair - The judged consumer pair, or `null` when there is none.
 * @property {string | undefined} repo - `owner/name`, for the update-PR search.
 */

/** How many NEW paths are shown before "N more". */
const SHOWN_PATHS = 3;

/** Verdict text per gate verdict. */
const VERDICTS = Object.freeze({
  compatible: 'compatible',
  new: 'not compatible',
  unknown: 'unknown (the gate could not decide)',
});

const INTRO =
  'Compatible means the browser-stack gate (`--mode candidate`) found no unaccepted' +
  ' Juggler delta. It does not mean landable: only the coupled bump, with its contract' +
  ' and E2E tests, proves that.';

/** @type {(text: string) => string} */
const code = text => `\`${text}\``;

/** NEW paths: the first {@link SHOWN_PATHS}, then how many more. */
function pathList(/** @type {readonly string[]} */ paths) {
  const shown = paths.slice(0, SHOWN_PATHS).map(code);
  const hidden = paths.length - shown.length;
  return [...shown, ...(hidden > 0 ? [`${hidden} more`] : [])].join(', ');
}

/** @type {(platform: string) => string} */
const noRelease = platform =>
  `camoufox-js finds no stable release with a ${platform} asset on the first releases` +
  ' page: a consumer install fails.';

/** @type {(range: string, selected: string) => string} */
const noVersion = (range, selected) =>
  `No stable playwright-core version satisfies ${code(range)} to pair with ${code(selected)}.`;

/** @type {(pair: WatchPair, range: string) => string} The consumer pair and its verdict. */
const pairLine = (pair, range) =>
  `playwright-core ${code(pair.playwright)} (what a consumer's ${code(range)} resolves to)` +
  ` × Camoufox ${code(pair.tag)} (what camoufox-js installs): **${VERDICTS[pair.verdict]}**` +
  `${pair.newPaths.length > 0 ? ` — NEW: ${pathList(pair.newPaths)}` : ''}.`;

/** @type {(pair: WatchPair) => string[]} Why the gate could not decide, one line per error. */
const errorLines = pair =>
  pair.verdict === 'unknown'
    ? ['', 'The gate could not decide:', ...pair.errors.map(e => `- ${e}`)]
    : [];

/** The pair a consumer install gets today and its verdict, or why there is none. */
function consumerSection(/** @type {Watch} */ watch) {
  if (watch.selected === null) return noRelease(watch.platform);
  if (watch.pair === null) return noVersion(watch.range, watch.selected);
  return [pairLine(watch.pair, watch.range), ...errorLines(watch.pair)].join('\n');
}

/** Whether CI tests the release camoufox-js installs. */
function driftSection(/** @type {Watch} */ watch) {
  const ci = `CI installs Camoufox ${code(watch.manifestTag)} (\`browser-stack.json\`)`;
  const tag = watch.selected === null ? 'none' : code(watch.selected);
  const status = watch.selected === watch.manifestTag ? 'in step' : 'drift';
  return `${ci}; camoufox-js installs ${tag}: **${status}**.`;
}

/**
 * Section titles and renderers, in body order.
 *
 * @type {readonly (readonly [string, (watch: Watch) => string])[]}
 */
const SECTIONS = Object.freeze([
  ['Consumer pair', consumerSection],
  ['CI drift', driftSection],
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
  const sections = SECTIONS.flatMap(([title, render]) => ['', `### ${title}`, '', render(watch)]);
  return `${[...intro, '', INTRO, ...sections, ...prLink(watch.repo)].join('\n')}\n`;
}
