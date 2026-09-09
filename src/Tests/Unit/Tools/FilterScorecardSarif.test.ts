/**
 * Unit test for `scripts/filter-scorecard-sarif.mjs`.
 *
 * <p>The script removes OpenSSF Scorecard `PinnedDependenciesID` results that
 * are really GitHub's `$/` self-repository syntax, which Scorecard v2.4.4
 * cannot parse and misreports as unpinned third-party actions (upstream
 * https://github.com/ossf/scorecard/issues/5191). It runs between
 * `ossf/scorecard-action` and the SARIF upload in `scorecard.yml`, so both
 * scanners are satisfied at once: `$/` stays (zizmor's `self-repository`
 * audit requires it) and the false code-scanning alerts never appear.
 *
 * <p>The one property that must never regress is surgical scope: a genuinely
 * unpinned third-party action does NOT use `$/`, so it must survive the
 * filter and still be reported. These cases pin that, driving the pure core
 * with an injected line resolver so the assertions are about the filtering
 * rule alone, not about any file on disk.
 */
import { filterSarif } from '../../../../scripts/filter-scorecard-sarif.mjs';

/** A one-run SARIF document as the filter mutates it. */
interface ISarifDoc {
  readonly runs: { results: ISarifResult[] }[];
}

/** A single SARIF result as the filter reads it. */
interface ISarifResult {
  readonly ruleId: string;
  readonly locations?: readonly {
    readonly physicalLocation?: {
      readonly artifactLocation?: { readonly uri?: string };
      readonly region?: { readonly startLine?: number };
    };
  }[];
}

/** The pinned-dependencies rule Scorecard misfires on `$/`. */
const PINNED_RULE = 'PinnedDependenciesID';

/**
 * Build a SARIF result flagged at one file:line.
 *
 * @param ruleId - Rule the result is attributed to.
 * @param uri - Flagged file, or undefined for a location-less result.
 * @param line - Flagged 1-based line.
 * @returns A minimal SARIF result.
 */
function makeResult(ruleId: string, uri?: string, line = 1): ISarifResult {
  if (uri === undefined) return { ruleId };
  const physicalLocation = { artifactLocation: { uri }, region: { startLine: line } };
  return { ruleId, locations: [{ physicalLocation }] };
}

/**
 * Wrap results in a one-run SARIF document.
 *
 * @param results - Results to place in the run.
 * @returns A SARIF document with a single run.
 */
function makeSarif(results: readonly ISarifResult[]): ISarifDoc {
  return { runs: [{ results: [...results] }] };
}

/** Source lines the injected resolver returns, keyed by `uri:line`. */
const SOURCE_LINES: Readonly<Record<string, string>> = {
  'wf.yml:1': '      - uses: $/.github/actions/setup-node-deps',
  'wf.yml:2': '    uses: $/.github/workflows/codeql.yml',
  'wf.yml:3': '      - uses: some-org/third-party-action@main',
  'wf.yml:4': '      - uses: actions/checkout@3d3c42e # v7.0.1',
};

/**
 * A line resolver backed by the fixture map, never the filesystem.
 *
 * @param uri - Flagged file.
 * @param line - Flagged 1-based line.
 * @returns The fixture source line, or an empty string when unmapped.
 */
function resolveLine(uri: string, line: number): string {
  return SOURCE_LINES[`${uri}:${String(line)}`] ?? '';
}

/**
 * The rule ids surviving a filter pass over a one-run SARIF document.
 *
 * @param results - Results to filter.
 * @returns Kept rule ids and how many were removed.
 */
function filterOnce(results: readonly ISarifResult[]): { kept: string[]; removed: number } {
  const sarif = makeSarif(results);
  const removed = filterSarif(sarif, resolveLine);
  const kept = sarif.runs[0].results.map(result => result.ruleId);
  return { kept, removed };
}

describe('filter-scorecard-sarif $/ false-positive removal', () => {
  it('[FSS-1] drops a PinnedDependenciesID hit on a `$/` action reference', () => {
    const outcome = filterOnce([makeResult(PINNED_RULE, 'wf.yml', 1)]);
    expect(outcome.kept).toHaveLength(0);
  });

  it('[FSS-2] drops a PinnedDependenciesID hit on a `$/` reusable-workflow reference', () => {
    const outcome = filterOnce([makeResult(PINNED_RULE, 'wf.yml', 2)]);
    expect(outcome.kept).toHaveLength(0);
  });

  it('[FSS-3] KEEPS a PinnedDependenciesID hit on a genuinely unpinned third-party action', () => {
    const outcome = filterOnce([makeResult(PINNED_RULE, 'wf.yml', 3)]);
    expect(outcome.kept).toEqual([PINNED_RULE]);
  });

  it('[FSS-4] keeps a non-pinned-dependencies rule even when its line is `$/`', () => {
    const outcome = filterOnce([makeResult('VulnerabilitiesID', 'wf.yml', 1)]);
    expect(outcome.kept).toEqual(['VulnerabilitiesID']);
  });

  it('[FSS-5] keeps a PinnedDependenciesID hit that carries no physical location', () => {
    const outcome = filterOnce([makeResult(PINNED_RULE, undefined)]);
    expect(outcome.kept).toEqual([PINNED_RULE]);
  });

  it('[FSS-6] removes only the `$/` hits from a mixed run and counts them', () => {
    const mixed = [
      makeResult(PINNED_RULE, 'wf.yml', 1),
      makeResult(PINNED_RULE, 'wf.yml', 3),
      makeResult(PINNED_RULE, 'wf.yml', 2),
      makeResult('VulnerabilitiesID', 'wf.yml', 4),
    ];
    const outcome = filterOnce(mixed);
    expect(outcome.kept).toEqual([PINNED_RULE, 'VulnerabilitiesID']);
  });

  it('[FSS-7] reports the number of removed false positives', () => {
    const mixed = [makeResult(PINNED_RULE, 'wf.yml', 1), makeResult(PINNED_RULE, 'wf.yml', 3)];
    const outcome = filterOnce(mixed);
    expect(outcome.removed).toBe(1);
  });
});
