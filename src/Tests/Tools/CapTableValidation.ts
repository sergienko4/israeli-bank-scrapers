/**
 * CAP TABLE VALIDATION — checks `CapOverrides.ts` against itself.
 *
 * <p>The per-file audit in `EslintCapProbe.ts` only proves that ESLint and the
 * table AGREE. It cannot tell that an entry has stopped doing any work, because
 * an entry predicting nothing never contradicts anything.
 *
 * <p>Two decay modes are caught here. A DEAD entry wins for no production file,
 * usually because the tree moved or a longer child entry now covers every file
 * it used to govern; it keeps "predicting" a tree that no longer exists, so a
 * later move could reintroduce that tree at the wrong cap unnoticed. A
 * DUPLICATE `(rule, prefix)` pair makes the longest-match tie-break arbitrary,
 * so one of the two could silently never apply.
 *
 * <p>Containment is deliberately not used to decide liveness: an entry can
 * cover files that all select a longer child entry, which leaves it dead while
 * still looking used. Liveness is therefore recorded from actual winners.
 */

import { CAP_OVERRIDES, type ICapOverride } from './CapOverrides.js';
import { CANONICAL_CAPS } from './CapRegimeTable.js';
import { type ICapRegimeFailure, winningOverrides } from './CapResolution.js';

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
 * Flag duplicate `(rule, prefix)` entries.
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
export default function tableFailures(paths: readonly string[]): readonly ICapRegimeFailure[] {
  const ruleIds = Object.keys(CANONICAL_CAPS);
  const empty = new Set<string>();
  const selected = recordWinners(paths, ruleIds, empty);
  const stale = staleOverrideFailures(selected);
  const dupes = duplicateOverrideFailures();
  return [...stale, ...dupes];
}
