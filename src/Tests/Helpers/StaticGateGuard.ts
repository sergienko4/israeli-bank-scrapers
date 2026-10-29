/**
 * The trigger inside a guarded gate of the `Static checks` job in `pr.yml`.
 *
 * <p>Every foreground gate after the job's `ready` step runs under
 * `${{ !cancelled() && steps.ready.outcome == 'success' && (<trigger>) }}`
 * rather than the implicit `success()`, so one failing gate no longer skips
 * the gates after it and a single run reports every failure. Suites that read
 * which change flags fire a gate strip that guard here, and read the trigger.
 */

const GUARD_OPEN = "${{ !cancelled() && steps.ready.outcome == 'success' && (";
const GUARD_CLOSE = ') }}';
const INNERMOST_GROUP = /\([^()]*\)/gu;
const PARENTHESIS = /[()]/u;

/**
 * Remove every parenthesised group, innermost first.
 *
 * @param text - An expression.
 * @returns What is left; any parenthesis in it is unpaired.
 */
function withoutGroups(text: string): string {
  const flat = text.replace(INNERMOST_GROUP, '');
  return flat === text ? flat : withoutGroups(flat);
}

/**
 * The trigger of a gate's `if:`.
 *
 * @param condition - The `if:` text.
 * @returns The trigger group when the condition is exactly the guard around
 *   one group, else the condition unchanged.
 */
export default function gateTrigger(condition: string): string {
  const isWrapped = condition.startsWith(GUARD_OPEN) && condition.endsWith(GUARD_CLOSE);
  const inner = condition.slice(GUARD_OPEN.length, -GUARD_CLOSE.length);
  const leftover = withoutGroups(inner);
  const isOneGroup = !PARENTHESIS.test(leftover);
  return isWrapped && isOneGroup ? inner : condition;
}
