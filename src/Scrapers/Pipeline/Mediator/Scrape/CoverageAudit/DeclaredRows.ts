/**
 * Declared-row reconciliation — the guardrail that takes the provider at its
 * word.
 *
 * The coverage audit answers "did we read everything?" heuristically, by
 * re-hunting the body. This answers the same question *authoritatively* for
 * containers where the provider states its own row count beside the rows.
 * Where such a count exists it cannot be argued with: declared 12, extracted 0
 * is loss, full stop, from one response and with no second run to compare.
 *
 * A count is an oracle only when it sits beside the rows it counts, which is
 * why {@link IDeclaredRowSpec} is sibling-scoped: response-level totals were
 * measured and rejected. See docs/observability/coverage-audit.md for those
 * measurements and for the one container this catches today — the same
 * container whose omission lost ~47% of a real Isracard statement.
 *
 * **What this deliberately does not cover.** The comparison is declared count
 * against the rows *present in the response*, not against the rows the shape
 * returned. A container that arrives complete but that the shape fails to read
 * therefore passes here with a zero shortfall. That half of the problem belongs
 * to {@link auditCoverage}, which re-hunts the body and counts what the shape
 * did not return; between them the two cover both directions. Extending this
 * check to be extraction-aware would need a per-bank contract change, because
 * extracted rows arrive as opaque objects with no back-reference to the
 * container they came from — recorded as a follow-up rather than guessed at.
 */

import { getDebug } from '../../../Logging/Debug.js';

const LOG = getDebug(import.meta.url);

type Bag = Record<string, unknown>;

/**
 * Where one container states its own row count.
 *
 * <p>Config, not logic: a bank adopts the guardrail by naming three paths and
 * the traversal below is shared, so a new adopter adds data and no code.
 */
export interface IDeclaredRowSpec {
  /** Dotted path from the response body to the array of groups. */
  readonly groups: string;
  /** Property on each group holding that group's row array. */
  readonly rows: string;
  /** Dotted path on each group holding that group's declared count. */
  readonly count: string;
}

/** Inputs for one declared-row reconciliation. */
export interface IDeclaredArgs {
  /** Raw response body, exactly as received. */
  readonly body: object;
  /** Declarations this bank's response carries. Empty disables the check. */
  readonly specs: readonly IDeclaredRowSpec[];
  /** Bank + step identity for the log line. Never contains row content. */
  readonly label: string;
}

/** Outcome of one reconciliation. Counts only — never row content. */
export interface IDeclaredResult {
  /** Groups that stated a count, so were checkable. */
  readonly checked: number;
  /** Rows declared but not carried by the response, summed. Above zero means loss. */
  readonly shortfall: number;
}

/**
 * Read a dotted path, tolerating every absent link along the way.
 * @param node - Node to read from.
 * @param path - Dotted path relative to that node.
 * @returns Value at the path, or nothing when any link is absent.
 */
function atPath(node: unknown, path: string): unknown {
  const parts = path.split('.');
  return parts.reduce<unknown>((acc, part): unknown => (acc as Bag | undefined)?.[part], node);
}

/**
 * Read a node as an array, treating anything else as empty.
 * @param node - Candidate array node.
 * @returns The array, or empty when absent or another type.
 */
function asRows(node: unknown): readonly unknown[] {
  return Array.isArray(node) ? node : [];
}

/**
 * Read a node as a declared count.
 * @param node - Candidate count node.
 * @returns The count, or false when the group declares none.
 */
function countOf(node: unknown): number | false {
  const isCount = typeof node === 'number' && Number.isFinite(node);
  return isCount ? node : false;
}

/**
 * Rows one group declared but did not carry.
 * @param group - One group node.
 * @param spec - Where that group states its rows and its count.
 * @returns Declared minus carried, or false when it declares nothing.
 */
function gapOf(group: unknown, spec: IDeclaredRowSpec): number | false {
  const declaredNode = atPath(group, spec.count);
  const declared = countOf(declaredNode);
  if (declared === false) return false;
  const rows = asRows((group as Bag)[spec.rows]);
  return declared - rows.length;
}

/**
 * Every checkable gap under one declaration.
 * @param body - Raw response body.
 * @param spec - One declaration.
 * @returns One gap per group that stated a count.
 */
function gapsOf(body: object, spec: IDeclaredRowSpec): readonly number[] {
  const node = atPath(body, spec.groups);
  const groups = asRows(node);
  const gaps = groups.map((g): number | false => gapOf(g, spec));
  return gaps.filter((g): g is number => g !== false);
}

/**
 * Build the one-line declared-row verdict.
 * @param label - Bank + step identity.
 * @param result - Counts for the round.
 * @returns Log message carrying counts only.
 */
function declaredMessage(label: string, result: IDeclaredResult): string {
  const detail = `checked=${String(result.checked)}`;
  if (result.shortfall === 0) return `declared ${label}: complete (${detail})`;
  return `declared ${label}: SHORTFALL — missing=${String(result.shortfall)} (${detail})`;
}

/**
 * Emit the verdict. Counts and the caller's label only, per
 * logging-pii-guidlines.md.
 *
 * <p>A shortfall warns because the provider contradicts us: it said it sent
 * rows we did not return. Unlike the heuristic audit there is no room to call
 * it a false positive, so the line is always actionable.
 *
 * @param label - Bank + step identity.
 * @param result - Counts for the round.
 * @returns The same counts, so callers report and return in one step.
 */
function reportDeclared(label: string, result: IDeclaredResult): IDeclaredResult {
  const message = declaredMessage(label, result);
  const isComplete = result.shortfall === 0;
  if (isComplete) LOG.debug({ message });
  else LOG.warn({ message });
  return result;
}

/**
 * Compare what a container carried against what it said it carried.
 *
 * Reports only; never repairs. A shortfall means the shape reads the wrong
 * path or the provider changed one — both are reviewed code changes.
 *
 * @param args - Response body, declarations, and log identity.
 * @returns Counts for the round.
 */
export function auditDeclaredRows(args: IDeclaredArgs): IDeclaredResult {
  const isEnabled = args.specs.length > 0;
  if (!isEnabled) return { checked: 0, shortfall: 0 };
  const gaps = args.specs.flatMap((s): readonly number[] => gapsOf(args.body, s));
  const missing = gaps.filter((g): boolean => g > 0);
  const shortfall = missing.reduce((a, b): number => a + b, 0);
  return reportDeclared(args.label, { checked: gaps.length, shortfall });
}
