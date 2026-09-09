/**
 * Type declarations for `scripts/filter-scorecard-sarif.mjs`.
 *
 * The script is plain Node (`allowJs: false` in tsconfig), so the `.ts` test
 * that drives its pure core needs this to type its assertions rather than
 * import `any`.
 */

/** Resolves the 1-based source line a SARIF result points at. */
export type ResolveLine = (uri: string, line: number) => string;

/** The minimal shape of a SARIF result the filter reads. */
export interface ScorecardSarifResult {
  readonly ruleId?: string;
  readonly rule?: { readonly id?: string };
  readonly locations?: readonly {
    readonly physicalLocation?: {
      readonly artifactLocation?: { readonly uri?: string };
      readonly region?: { readonly startLine?: number };
    };
  }[];
}

/** The minimal SARIF document shape the filter mutates in place. */
export interface ScorecardSarif {
  runs?: { results?: ScorecardSarifResult[] }[];
}

/**
 * Remove every `$/` self-repository `PinnedDependenciesID` false positive from
 * a parsed SARIF document, in place.
 *
 * @param sarif - Parsed SARIF document, mutated in place.
 * @param resolveLine - Reads the source line a result points at.
 * @returns Total number of results removed across all runs.
 */
export function filterSarif(sarif: ScorecardSarif, resolveLine: ResolveLine): number;
