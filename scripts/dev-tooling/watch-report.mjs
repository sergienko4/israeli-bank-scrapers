/**
 * Markdown report of the dev-tooling watch, shown on the probe job's summary.
 *
 * Three sections: the verdict; the candidates (each `lint-tooling` package,
 * locked version → newest same-major release); and, when the gates ran,
 * whether each passed, with the last lines of every failing gate's output.
 * When the probe could not install the candidates, the errors replace the
 * gates.
 */

/**
 * @typedef {'pass' | 'fail' | 'error' | 'no-candidate'} Verdict - What the probe found.
 *
 * @typedef {object} Candidate - A package the probe installs.
 * @property {string} name - Package name.
 * @property {string} from - The locked version.
 * @property {string} to - The newest stable release with the same major.
 *
 * @typedef {object} GateResult - One gate run on the candidates.
 * @property {string} name - Gate name.
 * @property {boolean} passed - Whether it exited 0.
 * @property {string} tail - The last lines of its output when it failed, else empty.
 * @property {string} [unfinished] - Why it did not finish (timed out, killed, left no time); absent when it exited.
 *
 * @typedef {object} Watch - Everything the report holds.
 * @property {string} checkedOn - `yyyy-mm-dd`.
 * @property {Verdict} verdict - What the probe found.
 * @property {readonly Candidate[]} candidates - What it installed.
 * @property {readonly GateResult[]} gates - The gates, in run order; empty when none ran.
 * @property {readonly string[]} errors - Why the probe could not finish: the install, or a gate.
 */

/** A fence no gate output closes early: gate output may hold ``` itself. */
const FENCE = '````';

const RUNBOOK = '`docs/workflow/dependency-updates.md`';

/** Verdict text per verdict. */
const VERDICTS = Object.freeze({
  pass: '**pass** — every gate passes: the next lint-tooling update should go green.',
  fail:
    '**fail** — a gate fails: the next lint-tooling update will be red. Fix the code on' +
    ` \`main\` first, as ${RUNBOOK} describes, and the update goes green when it arrives.`,
  error:
    '**error** — the probe could not finish: the candidates did not install, or a gate' +
    ' timed out, was killed or was left no time. Its result says nothing about the update;' +
    ' see Errors.',
  'no-candidate':
    '**no candidate** — every lint-tooling package is on its newest same-major release.',
});

const INTRO =
  'The probe installs the newest same-major release of each `lint-tooling` package, without' +
  ' touching `package.json` or the lockfile, and runs the static gates the grouped' +
  ' Dependabot update must pass. It opens and changes no PR.';

/** @type {(text: string) => string} */
const code = text => `\`${text}\``;

/** @type {(text: string) => string[]} Text in a fence. */
const fenced = text => [FENCE, text, FENCE];

/** @type {(candidate: Candidate) => string} One table row. */
const candidateRow = c => `| ${code(c.name)} | ${code(c.from)} | ${code(c.to)} |`;

/** The candidates as a table, or that there are none. */
function candidateSection(/** @type {Watch} */ watch) {
  if (watch.candidates.length === 0) return ['None.'];
  const head = ['| Package | Locked | Newest same-major |', '| --- | --- | --- |'];
  return [...head, ...watch.candidates.map(candidateRow)];
}

/** @type {(gate: GateResult) => string} One gate and its result. */
const gateLine = gate => `- ${gate.name}: ${gate.passed ? 'pass' : '**fail**'}`;

/** @type {(gate: GateResult) => string[]} A failing gate's last lines of output. */
const failureBlock = gate =>
  gate.passed ? [] : ['', `#### ${gate.name}`, '', ...fenced(gate.tail)];

/** Every gate's result, then the output of each failing one. */
function gateSection(/** @type {Watch} */ watch) {
  return [...watch.gates.map(gateLine), ...watch.gates.flatMap(failureBlock)];
}

/** Why the candidates could not be installed. */
function errorSection(/** @type {Watch} */ watch) {
  return watch.errors.flatMap((error, i) => [...(i > 0 ? [''] : []), ...fenced(error)]);
}

/**
 * Section titles, renderers, and whether the section shows.
 *
 * @type {readonly (readonly [string, (watch: Watch) => string[], (watch: Watch) => boolean])[]}
 */
const SECTIONS = Object.freeze([
  ['Verdict', watch => [VERDICTS[watch.verdict]], () => true],
  ['Candidates', candidateSection, () => true],
  ['Gates', gateSection, watch => watch.gates.length > 0],
  ['Errors', errorSection, watch => watch.errors.length > 0],
]);

/**
 * The issue body.
 *
 * @param {Watch} watch - What the body reports.
 * @returns {string} Markdown ending in a newline.
 */
export function renderWatch(watch) {
  const intro = ['## Dev-tooling watch', '', `Checked ${watch.checkedOn}.`, '', INTRO];
  const shown = SECTIONS.filter(([, , shows]) => shows(watch));
  const sections = shown.flatMap(([title, render]) => ['', `### ${title}`, '', ...render(watch)]);
  return `${[...intro, ...sections].join('\n')}\n`;
}
