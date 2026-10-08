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

/** The id of every `fixtures-pii` rule, in evaluation order. */
export const RULE_IDS: readonly string[];
