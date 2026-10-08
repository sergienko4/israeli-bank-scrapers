/**
 * Type declarations for `scripts/audit-fixtures-pii.cjs`.
 *
 * The script is plain Node (`allowJs: false` in tsconfig), so the `.ts`
 * parity suite that drives its pure core needs this to type its assertions
 * rather than import `any`.
 */

/** Severity of an audit rule; `INFO` marks an already-redacted placeholder. */
export type AuditSeverity = 'CRITICAL' | 'HIGH' | 'INFO';

/** One audit hit that is not a known false positive. */
export interface AuditHit {
  readonly pat: { readonly id: string; readonly severity: AuditSeverity };
  readonly match: string;
  readonly at: number;
  readonly ctx: string;
}

/**
 * Audit one fixture's text against every `fixtures-pii` rule.
 *
 * @param raw - Fixture contents.
 * @returns Hits that are not known false positives, INFO markers included.
 */
export function auditText(raw: string): AuditHit[];

/** Tally of every fixture's top hits, and the gate verdict. */
export interface AuditSummary {
  readonly critical: number;
  readonly high: number;
  readonly filesWithHits: number;
  readonly failed: boolean;
}

/**
 * One report line for a hit: severity, rule id, line:column and match
 * length. Never the matched text or its context.
 *
 * @param hit - The hit to report.
 * @param raw - Fixture contents the hit was found in.
 * @returns The report line.
 */
export function formatHit(hit: AuditHit, raw: string): string;

/**
 * Report lines for one fixture: a header, its top 15 CRITICAL and HIGH hits
 * (CRITICAL first) and a count of the hits left out.
 *
 * @param rel - Fixture path relative to the repo root.
 * @param raw - Fixture contents.
 * @param hits - Hits of the fixture, INFO markers included.
 * @returns The lines, or none when no CRITICAL or HIGH hit fired.
 */
export function renderFileReport(rel: string, raw: string, hits: readonly AuditHit[]): string[];

/**
 * Tally every fixture's top 15 CRITICAL and HIGH hits into the verdict.
 *
 * @param hitLists - Hits of each fixture, INFO markers included.
 * @returns The counts, and whether the gate fails.
 */
export function summarizeReports(hitLists: readonly (readonly AuditHit[])[]): AuditSummary;

/**
 * The summary block and FAIL or PASS verdict line the gate prints last.
 *
 * @param fileCount - Number of fixtures scanned.
 * @param summary - The tally.
 * @returns The lines.
 */
export function renderSummary(fileCount: number, summary: AuditSummary): string[];

/** The id of every `fixtures-pii` rule, in evaluation order. */
export const RULE_IDS: readonly string[];
