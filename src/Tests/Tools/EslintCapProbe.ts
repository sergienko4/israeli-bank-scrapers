/**
 * ESLINT CAP PROBE — resolves the caps `eslint.config.mjs` actually imposes.
 *
 * <p>Everything here drives ESLint's own flat-config resolver rather than
 * parsing the config text. Text analysis cannot answer "what cap does this
 * directory end up with?", because flat config is last-wins across ~2 800 lines
 * of overlapping globs — only the resolver knows the winner.
 *
 * <p>The regime audit compares that resolved answer against `CapRegimeTable.ts`
 * for EVERY production directory, so a deleted grandfather-then-tighten block
 * fails by name instead of silently relaxing shipped code.
 */

import * as fs from 'node:fs';

import type { ESLint } from 'eslint';

import {
  CANARY_DIR,
  CANONICAL_CAPS,
  CAP_OVERRIDES,
  type ICapOverride,
  PRODUCTION_ROOTS,
  type TResolvedCap,
} from './CapRegimeTable.js';

/** A resolved cap, plus the state where the rule is not configured at all. */
export type TObservedCap = TResolvedCap | 'absent';

/** One directory whose resolved cap disagrees with the cap table. */
export interface ICapRegimeFailure {
  readonly dir: string;
  readonly file: string;
  readonly ruleId: string;
  readonly reason: string;
}

/** Outcome of a full regime audit: what failed, and how much was covered. */
export interface ICapRegimeResult {
  readonly failures: readonly ICapRegimeFailure[];
  readonly dirCount: number;
}

/** One directory + rule pair being checked against the cap table. */
interface IRegimeProbe {
  readonly dir: string;
  readonly file: string;
  readonly ruleId: string;
}

/**
 * Pull the `max` numeric option out of an ESLint rule entry. Supports
 * both shorthand `['error', 10]` and structured `['error', { max: 10 }]`.
 * @param value - Raw rule entry (severity or [severity, ...options]).
 * @returns The numeric cap, or -1 when not inspectable.
 */
export function extractRuleMax(value: unknown): number {
  const valueArr: readonly unknown[] = Array.isArray(value) ? value : [value];
  if (valueArr.length < 2) return -1;
  const opts: unknown = valueArr[1];
  if (typeof opts === 'number') return opts;
  if (typeof opts === 'object' && opts !== null && 'max' in opts) {
    const maxVal = opts.max;
    return typeof maxVal === 'number' ? maxVal : -1;
  }
  return -1;
}

/**
 * Whether a rule entry is disabled (severity `'off'` or `0`).
 * @param value - Raw rule entry.
 * @returns True when ESLint would treat the rule as turned off.
 */
export function isRuleOff(value: unknown): boolean {
  if (value === 'off' || value === 0) return true;
  if (Array.isArray(value) && (value[0] === 'off' || value[0] === 0)) return true;
  return false;
}

/**
 * Resolve the effective rule set ESLint would apply to one file.
 * @param eslint - ESLint instance loading `eslint.config.mjs`.
 * @param file - Repo-relative path to a representative file.
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
 * Collect ONE representative `.ts` file per production directory.
 *
 * A directory's resolved config is uniform across its own files, so one probe
 * per directory characterises its regime while keeping the walk cheap.
 * @param root - Directory to walk, repo-relative with forward slashes.
 * @param into - Accumulator mapping directory to its representative file.
 * @returns The accumulator, so callers can chain roots.
 */
function collectRepresentatives(root: string, into: Map<string, string>): Map<string, string> {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = `${root}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== CANARY_DIR) collectRepresentatives(full, into);
      continue;
    }
    const isSource = entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts');
    const isFirstHere = !into.has(root);
    if (isSource && isFirstHere) into.set(root, full);
  }
  return into;
}

/**
 * Whether a directory sits inside a cap-table prefix (the prefix itself counts).
 * @param dir - Repo-relative directory.
 * @param prefix - Cap-table prefix.
 * @returns True when the prefix governs that directory.
 */
function isUnderPrefix(dir: string, prefix: string): boolean {
  const isSame = dir === prefix;
  const isChild = dir.startsWith(`${prefix}/`);
  return isSame || isChild;
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
 * The cap the table predicts for a directory: the LONGEST matching prefix wins,
 * mirroring flat config's last-wins precedence; otherwise the canonical value.
 * @param dir - Repo-relative directory.
 * @param ruleId - Rule being predicted.
 * @returns The exact cap that directory must resolve to.
 */
function expectedCap(dir: string, ruleId: string): TResolvedCap {
  const overrides: readonly ICapOverride[] = CAP_OVERRIDES[ruleId] ?? [];
  const matched = overrides.filter((o): boolean => isUnderPrefix(dir, o.prefix));
  if (matched.length === 0) return CANONICAL_CAPS[ruleId];
  const ranked = [...matched].sort((a, b): number => b.prefix.length - a.prefix.length);
  return ranked[0].cap;
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
 * Compare ONE directory + rule against the cap table.
 *
 * Mismatch is a failure in BOTH directions: looser is a regression, tighter
 * means a tree was drained without updating the table in the same PR, which
 * `eslint-rules-guidlines.md` §1 requires.
 * @param resolved - Effective rules for the directory's representative file.
 * @param probe - Directory, representative file and rule under test.
 * @returns One failure record, or nothing when the regimes agree.
 */
function regimeFailure(
  resolved: Record<string, unknown>,
  probe: IRegimeProbe,
): readonly ICapRegimeFailure[] {
  const actual = observedCap(resolved[probe.ruleId]);
  const expected = expectedCap(probe.dir, probe.ruleId);
  if (actual === expected) return [];
  const actualText = describeCap(actual);
  const expectedText = describeCap(expected);
  const failure: ICapRegimeFailure = {
    dir: probe.dir,
    file: probe.file,
    ruleId: probe.ruleId,
    reason: `resolves to ${actualText} but the cap table expects exactly ${expectedText}`,
  };
  return [failure];
}

/**
 * Audit every canonical rule for ONE production directory.
 * @param eslint - ESLint instance loading `eslint.config.mjs`.
 * @param dir - Repo-relative directory being audited.
 * @param file - Representative file inside that directory.
 * @returns Failure records (empty when the directory matches the table).
 */
async function auditDirectory(
  eslint: ESLint,
  dir: string,
  file: string,
): Promise<readonly ICapRegimeFailure[]> {
  const resolved = await resolveRulesForFile(eslint, file);
  const ruleIds = Object.keys(CANONICAL_CAPS);
  return ruleIds.flatMap((ruleId): readonly ICapRegimeFailure[] => {
    const probe: IRegimeProbe = { dir, file, ruleId };
    return regimeFailure(resolved, probe);
  });
}

/**
 * Flag cap-table entries that govern no production directory.
 *
 * A stale entry keeps "predicting" a tree that no longer exists, so a later
 * move could reintroduce that tree at the wrong cap without anyone noticing.
 * @param dirs - Every audited production directory.
 * @returns One failure per unused table entry.
 */
function staleOverrideFailures(dirs: readonly string[]): readonly ICapRegimeFailure[] {
  const entries = Object.entries(CAP_OVERRIDES);
  return entries.flatMap(([ruleId, list]): readonly ICapRegimeFailure[] => {
    const unused = list.filter(
      (o): boolean => !dirs.some((d): boolean => isUnderPrefix(d, o.prefix)),
    );
    return unused.map((o): ICapRegimeFailure => ({
      dir: o.prefix,
      file: o.prefix,
      ruleId,
      reason: 'cap-table entry governs no production directory — delete it',
    }));
  });
}

/**
 * Audit EVERY production directory against the cap table.
 * @param eslint - ESLint instance loading `eslint.config.mjs`.
 * @returns Failures plus the number of directories covered.
 */
export async function auditCapRegimes(eslint: ESLint): Promise<ICapRegimeResult> {
  const representatives = new Map<string, string>();
  for (const root of PRODUCTION_ROOTS) collectRepresentatives(root, representatives);
  const pairs = [...representatives];
  const promises = pairs.map(([dir, file]): Promise<readonly ICapRegimeFailure[]> =>
    auditDirectory(eslint, dir, file),
  );
  const results = await Promise.all(promises);
  const dirs: readonly string[] = [...representatives.keys()];
  const stale = staleOverrideFailures(dirs);
  const failures: readonly ICapRegimeFailure[] = [...results.flat(), ...stale];
  return { failures, dirCount: dirs.length };
}
