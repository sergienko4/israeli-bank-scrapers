/**
 * ESLINT CAP PROBE — resolves the caps `eslint.config.mjs` actually imposes.
 *
 * <p>Everything here drives ESLint's own flat-config resolver rather than
 * parsing the config text. Text analysis cannot answer "what cap does this file
 * end up with?", because flat config is last-wins across ~2 800 lines of
 * overlapping globs — only the resolver knows the winner.
 *
 * <p>The audit compares that resolved answer against `CapRegimeTable.ts` for
 * EVERY production file, so a deleted grandfather-then-tighten block fails by
 * name instead of silently relaxing shipped code.
 *
 * <p>Auditing per FILE rather than per directory is load-bearing. Several
 * blocks scope a cap to a single filename beside a differently-capped
 * directory — `Phases/Base/BasePhase.ts`, `Strategy/Scrape/ScrapeExecutor.ts`,
 * `Strategy/Scrape/ScrapeDataActions.ts` and
 * `Mediator/Init/NavigationTransportProbe.ts`. A one-probe-per-directory walk
 * cannot see those, so deleting such a scope stayed green.
 */

import * as fs from 'node:fs';

import type { ESLint } from 'eslint';

import {
  CANONICAL_CAPS,
  CAP_OVERRIDES,
  type ICapOverride,
  NON_PRODUCTION_DIRS,
  NON_PRODUCTION_SUFFIXES,
  PRODUCTION_ROOTS,
  type TResolvedCap,
} from './CapRegimeTable.js';

/** A resolved cap, plus the state where the rule is not configured at all. */
export type TObservedCap = TResolvedCap | 'absent';

/** One path whose resolved cap disagrees with the cap table. */
export interface ICapRegimeFailure {
  readonly path: string;
  readonly ruleId: string;
  readonly reason: string;
}

/** Outcome of a full regime audit: what failed, and how much was covered. */
export interface ICapRegimeResult {
  readonly failures: readonly ICapRegimeFailure[];
  readonly fileCount: number;
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
 * Whether a filename is production TypeScript rather than a test or a
 * declaration file, both of which carry their own regime.
 * @param name - Bare filename.
 * @returns True when the file belongs in the production audit.
 */
function isProductionSource(name: string): boolean {
  const isTs = name.endsWith('.ts');
  const isExcluded = NON_PRODUCTION_SUFFIXES.some((suffix): boolean => name.endsWith(suffix));
  return isTs && !isExcluded;
}

/**
 * Collect EVERY production `.ts` file under a root.
 * @param root - Directory to walk, repo-relative with forward slashes.
 * @param into - Accumulator of repo-relative file paths.
 * @returns The accumulator, so callers can chain roots.
 */
function collectProductionFiles(root: string, into: string[]): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = `${root}/${entry.name}`;
    const isWalkable = entry.isDirectory() && !NON_PRODUCTION_DIRS.includes(entry.name);
    if (isWalkable) collectProductionFiles(full, into);
    else if (!entry.isDirectory() && isProductionSource(entry.name)) into.push(full);
  }
  return into;
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
 * The single cap-table entry that wins for a path: LONGEST matching prefix,
 * mirroring flat config's last-wins precedence. An exact-file entry is always
 * longer than the directory containing it, so it wins — exactly as ESLint does.
 * @param path - Repo-relative file path.
 * @param ruleId - Rule being predicted.
 * @returns A one-element list, or empty when no entry matches.
 */
function winningOverrides(path: string, ruleId: string): readonly ICapOverride[] {
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
function regimeFailure(value: unknown, path: string, ruleId: string): readonly ICapRegimeFailure[] {
  const actual = observedCap(value);
  const expected = expectedCap(path, ruleId);
  if (actual === expected) return [];
  const reason = mismatchReason(actual, expected);
  return [{ path, ruleId, reason }];
}

/**
 * Audit every canonical rule for ONE production file.
 * @param eslint - ESLint instance loading `eslint.config.mjs`.
 * @param path - Repo-relative file being audited.
 * @returns Failure records (empty when the file matches the table).
 */
async function auditFile(eslint: ESLint, path: string): Promise<readonly ICapRegimeFailure[]> {
  const resolved = await resolveRulesForFile(eslint, path);
  const ruleIds = Object.keys(CANONICAL_CAPS);
  return ruleIds.flatMap((ruleId): readonly ICapRegimeFailure[] =>
    regimeFailure(resolved[ruleId], path, ruleId),
  );
}

/**
 * Identify one cap-table entry for winner bookkeeping.
 * @param ruleId - Rule the entry belongs to.
 * @param prefix - The entry's prefix.
 * @returns A collision-free key.
 */
function overrideKey(ruleId: string, prefix: string): string {
  return `${ruleId}\u0000${prefix}`;
}

/**
 * Record the winning entry for ONE file + rule pair.
 * @param path - Repo-relative file path.
 * @param ruleId - Rule being audited.
 * @param into - Accumulator of winning entry keys.
 * @returns The accumulator.
 */
function recordRuleWinner(path: string, ruleId: string, into: Set<string>): Set<string> {
  const winners = winningOverrides(path, ruleId);
  for (const winner of winners) {
    const key = overrideKey(ruleId, winner.prefix);
    into.add(key);
  }
  return into;
}

/**
 * Record the winning entries for ONE file across every audited rule.
 * @param path - Repo-relative file path.
 * @param ruleIds - Rules being audited.
 * @param into - Accumulator of winning entry keys.
 * @returns The accumulator.
 */
function recordFileWinners(
  path: string,
  ruleIds: readonly string[],
  into: Set<string>,
): Set<string> {
  for (const ruleId of ruleIds) recordRuleWinner(path, ruleId, into);
  return into;
}

/**
 * Record which cap-table entries actually WIN for at least one production file.
 *
 * Containment is not enough: an entry can cover files that all select a longer
 * child entry, which leaves it dead while still looking used.
 * @param paths - Every audited production file.
 * @param ruleIds - Rules being audited.
 * @param into - Accumulator of winning entry keys.
 * @returns The accumulator.
 */
function recordWinners(
  paths: readonly string[],
  ruleIds: readonly string[],
  into: Set<string>,
): Set<string> {
  for (const path of paths) recordFileWinners(path, ruleIds, into);
  return into;
}

/**
 * Build the failure record for a cap-table entry no file selects.
 * @param ruleId - Rule the entry belongs to.
 * @param override - The dead entry.
 * @returns One failure record.
 */
function staleFailure(ruleId: string, override: ICapOverride): ICapRegimeFailure {
  return {
    path: override.prefix,
    ruleId,
    reason: 'cap-table entry wins for no production file — delete it',
  };
}

/**
 * Whether a cap-table entry won for at least one production file.
 * @param selected - Keys of entries that won at least once.
 * @param ruleId - Rule the entry belongs to.
 * @param override - The entry being checked.
 * @returns True when some file selected this entry.
 */
function isOverrideSelected(
  selected: ReadonlySet<string>,
  ruleId: string,
  override: ICapOverride,
): boolean {
  const key = overrideKey(ruleId, override.prefix);
  return selected.has(key);
}

/**
 * Flag cap-table entries that win for no production file.
 *
 * A dead entry keeps "predicting" a tree that no longer exists, so a later move
 * could reintroduce that tree at the wrong cap without anyone noticing.
 * @param selected - Keys of entries that won at least once.
 * @returns One failure per dead table entry.
 */
function staleOverrideFailures(selected: ReadonlySet<string>): readonly ICapRegimeFailure[] {
  const entries = Object.entries(CAP_OVERRIDES);
  return entries.flatMap(([ruleId, list]): readonly ICapRegimeFailure[] => {
    const unused = list.filter((o): boolean => !isOverrideSelected(selected, ruleId, o));
    return unused.map((o): ICapRegimeFailure => staleFailure(ruleId, o));
  });
}

/**
 * Add a prefix to a seen-set, reporting whether it was new.
 * @param seen - Prefixes already recorded for this rule.
 * @param prefix - Prefix being added.
 * @returns True when the prefix had not been seen before.
 */
function isNewPrefix(seen: Set<string>, prefix: string): boolean {
  if (seen.has(prefix)) return false;
  seen.add(prefix);
  return true;
}

/**
 * Build the failure record for a duplicated cap-table entry.
 * @param ruleId - Rule the entry belongs to.
 * @param override - The duplicate entry.
 * @returns One failure record.
 */
function duplicateFailure(ruleId: string, override: ICapOverride): ICapRegimeFailure {
  return {
    path: override.prefix,
    ruleId,
    reason: 'duplicate cap-table entry for this rule — remove one',
  };
}

/**
 * Flag duplicate `(rule, prefix)` entries. Equal-length prefixes make the
 * longest-match tie-break arbitrary, so one entry could silently never apply.
 * @returns One failure per duplicate entry.
 */
function duplicateOverrideFailures(): readonly ICapRegimeFailure[] {
  const entries = Object.entries(CAP_OVERRIDES);
  return entries.flatMap(([ruleId, list]): readonly ICapRegimeFailure[] => {
    const seen = new Set<string>();
    const dupes = list.filter((o): boolean => !isNewPrefix(seen, o.prefix));
    return dupes.map((o): ICapRegimeFailure => duplicateFailure(ruleId, o));
  });
}

/**
 * Table-level problems, independent of what any single file resolves to.
 * @param paths - Every audited production file.
 * @returns Dead-entry and duplicate-entry failures.
 */
function tableFailures(paths: readonly string[]): readonly ICapRegimeFailure[] {
  const ruleIds = Object.keys(CANONICAL_CAPS);
  const empty = new Set<string>();
  const selected = recordWinners(paths, ruleIds, empty);
  const stale = staleOverrideFailures(selected);
  const dupes = duplicateOverrideFailures();
  return [...stale, ...dupes];
}

/**
 * Audit EVERY production file against the cap table.
 * @param eslint - ESLint instance loading `eslint.config.mjs`.
 * @returns Failures plus the number of files covered.
 */
export async function auditCapRegimes(eslint: ESLint): Promise<ICapRegimeResult> {
  const paths: string[] = [];
  for (const root of PRODUCTION_ROOTS) collectProductionFiles(root, paths);
  const probes = paths.map((p): Promise<readonly ICapRegimeFailure[]> => auditFile(eslint, p));
  const results = await Promise.all(probes);
  const tableIssues = tableFailures(paths);
  const failures: readonly ICapRegimeFailure[] = [...results.flat(), ...tableIssues];
  return { failures, fileCount: paths.length };
}
