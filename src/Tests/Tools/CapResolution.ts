/**
 * CAP RESOLUTION — what cap `eslint.config.mjs` actually imposes on one file.
 *
 * <p>Everything here drives ESLint's own flat-config resolver rather than
 * parsing the config text. Text analysis cannot answer "what cap does this file
 * end up with?", because flat config is last-wins across ~2 800 lines of
 * overlapping globs — only the resolver knows the winner.
 *
 * <p>This module resolves and compares a SINGLE file + rule pair. Walking the
 * tree lives in `EslintCapProbe.ts`; checking the table against itself lives in
 * `CapTableValidation.ts`.
 */

import type { ESLint } from 'eslint';

import { CAP_OVERRIDES, type ICapOverride, type TResolvedCap } from './CapOverrides.js';
import { CANONICAL_CAPS } from './CapRegimeTable.js';

/** A resolved cap, plus the state where the rule is not configured at all. */
export type TObservedCap = TResolvedCap | 'absent';

/** One path whose resolved cap disagrees with the cap table. */
export interface ICapRegimeFailure {
  readonly path: string;
  readonly ruleId: string;
  readonly reason: string;
}

/**
 * Pull the `max` numeric option out of an ESLint rule entry. Supports both
 * shorthand `['error', 10]` and structured `['error', { max: 10 }]`.
 * @param value - Raw rule entry (severity or [severity, ...options]).
 * @returns The numeric cap, or -1 when not inspectable.
 */
export function extractRuleMax(value: unknown): number {
  const valueArr: readonly unknown[] = Array.isArray(value) ? value : [value];
  if (valueArr.length < 2) return -1;
  const opts: unknown = valueArr[1];
  if (typeof opts === 'number') return opts;
  const hasMax = typeof opts === 'object' && opts !== null && 'max' in opts;
  if (!hasMax) return -1;
  const maxVal: unknown = opts.max;
  return typeof maxVal === 'number' ? maxVal : -1;
}

/**
 * Whether a rule entry is disabled (severity `'off'` or `0`).
 * @param value - Raw rule entry.
 * @returns True when ESLint would treat the rule as turned off.
 */
export function isRuleOff(value: unknown): boolean {
  if (value === 'off' || value === 0) return true;
  return Array.isArray(value) && (value[0] === 'off' || value[0] === 0);
}

/**
 * Resolve the effective rule set ESLint would apply to one file.
 * @param eslint - ESLint instance loading `eslint.config.mjs`.
 * @param file - Repo-relative path to the file being probed.
 * @returns Resolved rule map (empty object when none configured).
 */
export async function resolveRulesForFile(
  eslint: ESLint,
  file: string,
): Promise<Record<string, unknown>> {
  const cfg = (await eslint.calculateConfigForFile(file)) as { rules?: Record<string, unknown> };
  return cfg.rules ?? {};
}

/**
 * Whether a cap-table prefix governs a path. The prefix may name the file
 * itself, which is how filename-scoped config blocks are expressed.
 * @param path - Repo-relative file path.
 * @param prefix - Cap-table prefix.
 * @returns True when the prefix covers that path.
 */
function governsPath(path: string, prefix: string): boolean {
  const isSame = path === prefix;
  const isChild = path.startsWith(`${prefix}/`);
  return isSame || isChild;
}

/**
 * The single cap-table entry that wins for a path: the LONGEST matching prefix,
 * i.e. the most specific statement the table makes about that path.
 *
 * This is the TABLE's precedence rule, not a model of ESLint's. Flat config is
 * ordered, so a later-but-broader block beats an earlier narrow one. Entries
 * must therefore record the cap a tree actually RESOLVES to; where the two
 * rules disagree the audit reports a mismatch rather than passing silently.
 * @param path - Repo-relative file path.
 * @param ruleId - Rule being predicted.
 * @returns A one-element list, or empty when no entry matches.
 */
export function winningOverrides(path: string, ruleId: string): readonly ICapOverride[] {
  const overrides: readonly ICapOverride[] = CAP_OVERRIDES[ruleId] ?? [];
  const matched = overrides.filter((o): boolean => governsPath(path, o.prefix));
  if (matched.length === 0) return [];
  const ranked = [...matched].sort((a, b): number => b.prefix.length - a.prefix.length);
  return [ranked[0]];
}

/**
 * The cap the table predicts for a path, falling back to the canonical value.
 * @param path - Repo-relative file path.
 * @param ruleId - Rule being predicted.
 * @returns The exact cap that file must resolve to.
 */
function expectedCap(path: string, ruleId: string): TResolvedCap {
  const winners = winningOverrides(path, ruleId);
  if (winners.length === 0) return CANONICAL_CAPS[ruleId];
  return winners[0].cap;
}

/**
 * Reduce a resolved rule entry to the cap it actually imposes.
 * @param value - Raw rule entry from the resolved config.
 * @returns The numeric cap, `'off'`, or `'absent'` when not configured.
 */
function observedCap(value: unknown): TObservedCap {
  if (value === undefined) return 'absent';
  if (isRuleOff(value)) return 'off';
  const actualMax = extractRuleMax(value);
  return actualMax < 0 ? 'absent' : actualMax;
}

/**
 * Render a cap for a human-readable failure message.
 * @param cap - Observed or expected cap.
 * @returns Printable form.
 */
function describeCap(cap: TObservedCap): string {
  return typeof cap === 'number' ? String(cap) : cap;
}

/**
 * Describe a cap disagreement in one line.
 * @param actual - Cap ESLint resolved.
 * @param expected - Cap the table predicts.
 * @returns Human-readable reason.
 */
function mismatchReason(actual: TObservedCap, expected: TResolvedCap): string {
  const actualText = describeCap(actual);
  const expectedText = describeCap(expected);
  return `resolves to ${actualText} but the cap table expects exactly ${expectedText}`;
}

/**
 * Compare ONE file + rule against the cap table.
 *
 * Mismatch is a failure in BOTH directions: looser is a regression, tighter
 * means a tree was drained without updating the table in the same PR, which
 * `eslint-rules-guidlines.md` §1 requires.
 * @param value - Raw resolved rule entry for the file.
 * @param path - Repo-relative file path.
 * @param ruleId - Rule under test.
 * @returns One failure record, or nothing when the regimes agree.
 */
export function regimeFailure(
  value: unknown,
  path: string,
  ruleId: string,
): readonly ICapRegimeFailure[] {
  const actual = observedCap(value);
  const expected = expectedCap(path, ruleId);
  if (actual === expected) return [];
  return [{ path, ruleId, reason: mismatchReason(actual, expected) }];
}
