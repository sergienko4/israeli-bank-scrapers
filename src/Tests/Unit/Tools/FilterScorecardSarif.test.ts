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

/**
 * A single SARIF result as the filter reads it.
 *
 * <p>`ruleId` is optional and `rule.id` is modelled because the production
 * filter accepts the id in either place. Requiring `ruleId` here would let the
 * `rule.id` fallback be deleted with the suite still green.
 */
interface ISarifResult {
  readonly ruleId?: string;
  readonly rule?: { readonly id?: string };
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
  'wf.yml:5': '      - uses: some-org/third-party-action@main # port to $/.github/actions/x',
  'wf.yml:6': '      # - uses: $/.github/actions/setup-node-deps',
};

/** Raised when a case asks for a fixture line the map does not define. */
class UnmappedFixtureLineError extends Error {}

/**
 * A line resolver backed by the fixture map, never the filesystem.
 *
 * <p>An unmapped key throws rather than returning an empty string. An empty
 * string is not a `$/` reference, so a silently unmapped fixture would let the
 * "keeps a genuine third-party action" cases pass for the wrong reason: they
 * would be exercising the unresolved-line path instead of the filtering rule.
 *
 * @param uri - Flagged file.
 * @param line - Flagged 1-based line.
 * @returns The fixture source line.
 */
function resolveLine(uri: string, line: number): string {
  const key = `${uri}:${String(line)}`;
  if (!(key in SOURCE_LINES)) throw new UnmappedFixtureLineError(`unmapped fixture line: ${key}`);
  return SOURCE_LINES[key];
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
  const kept = sarif.runs[0].results.map(result => result.ruleId ?? result.rule?.id ?? '');
  return { kept, removed };
}

/** One single-result filter case driven from the fixture map. */
interface IFilterCase {
  readonly id: string;
  readonly what: string;
  readonly rule: string;
  readonly line: number;
}

/** Flagged lines that really are `$/` self-repository references. */
const DROPPED_CASES: IFilterCase[] = [
  { id: 'FSS-1', what: 'a `$/` action reference', rule: PINNED_RULE, line: 1 },
  { id: 'FSS-2', what: 'a `$/` reusable-workflow reference', rule: PINNED_RULE, line: 2 },
];

/**
 * Results that must survive the filter.
 *
 * <p>These encode the security property: a genuinely unpinned third-party
 * action does not use `$/`, so it must still be reported. FSS-9 and FSS-10 are
 * the property stated as a negative — a `$/` mentioned in a comment does not
 * make an action self-hosted, so a rule matching `$/` anywhere on the line
 * would silently drop a real supply-chain finding.
 */
const KEPT_CASES: IFilterCase[] = [
  { id: 'FSS-3', what: 'a genuinely unpinned third-party action', rule: PINNED_RULE, line: 3 },
  {
    id: 'FSS-4',
    what: 'a non-pinned-dependencies rule on a `$/` line',
    rule: 'VulnerabilitiesID',
    line: 1,
  },
  {
    id: 'FSS-9',
    what: 'a third-party action mentioning `$/` only in a comment',
    rule: PINNED_RULE,
    line: 5,
  },
  { id: 'FSS-10', what: 'a commented-out `$/` reference', rule: PINNED_RULE, line: 6 },
];

describe('filter-scorecard-sarif $/ false-positive removal', () => {
  it.each(DROPPED_CASES)('[$id] drops a PinnedDependenciesID hit on $what', ({ rule, line }) => {
    const outcome = filterOnce([makeResult(rule, 'wf.yml', line)]);
    expect(outcome.kept).toHaveLength(0);
  });

  it.each(KEPT_CASES)('[$id] KEEPS $what', ({ rule, line }) => {
    const outcome = filterOnce([makeResult(rule, 'wf.yml', line)]);
    expect(outcome.kept).toEqual([rule]);
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
    expect(outcome.removed).toBe(2);
  });

  it('[FSS-7] reports the number of removed false positives', () => {
    const mixed = [makeResult(PINNED_RULE, 'wf.yml', 1), makeResult(PINNED_RULE, 'wf.yml', 3)];
    const outcome = filterOnce(mixed);
    expect(outcome.removed).toBe(1);
  });

  /**
   * Scorecard emits a single run today, but the filter walks every run in the
   * document. Without this case, narrowing it to `runs[0]` alone would leave
   * the whole suite green while false positives in any later run still
   * reached code scanning. The genuine hit is placed in the first run so the
   * case also fails if the filter ever pruned only the last one.
   */
  it('[FSS-8] filters every run in the document, not just the first', () => {
    const sarif: ISarifDoc = {
      runs: [
        { results: [makeResult(PINNED_RULE, 'wf.yml', 3)] },
        { results: [makeResult(PINNED_RULE, 'wf.yml', 1)] },
      ],
    };
    const removed = filterSarif(sarif, resolveLine);
    const firstRunRules = sarif.runs[0].results.map(result => result.ruleId);
    const secondRunRules = sarif.runs[1].results.map(result => result.ruleId);
    expect(removed).toBe(1);
    expect(firstRunRules).toEqual([PINNED_RULE]);
    expect(secondRunRules).toHaveLength(0);
  });

  /**
   * SARIF may attribute a result through `rule.id` rather than `ruleId`, and
   * the filter reads both. Nothing else exercises the fallback, so dropping it
   * would leave every `$/` false positive in place with the suite still green.
   */
  it('[FSS-11] recognises a rule id supplied as `rule.id` instead of `ruleId`', () => {
    const physicalLocation = { artifactLocation: { uri: 'wf.yml' }, region: { startLine: 1 } };
    const viaRule: ISarifResult = { rule: { id: PINNED_RULE }, locations: [{ physicalLocation }] };
    const outcome = filterOnce([viaRule]);
    expect(outcome.removed).toBe(1);
    expect(outcome.kept).toHaveLength(0);
  });
});
