/**
 * NestedQuantifier — a build-time guard against catastrophic backtracking in
 * a configured regex. A group repeated by `*`, `+` or a `{n,}` / `{n,m}`
 * range that itself holds such a repeat, at any depth, can make a match take
 * exponential time, so a config naming one fails the build. Escapes,
 * character classes and exact `{n}` counts never repeat a variable amount, so
 * they are read as plain atoms first. Overlapping alternatives such as
 * `(a|a)*` are not detected; configured patterns stay simple and reviewed.
 */

/** Text that cannot repeat a variable amount: an escape, a class or `{n}`. */
const INERT = /\\.|\[(?:\\.|[^\]\\])*\]|\{\d+\}/gu;

/** The leftmost group with no group inside, and the quantifier after it. */
const INNERMOST_GROUP = /\(([^()]*)\)([*+{]?)/u;

/** A quantifier that repeats a variable number of times. */
const REPEAT = /[*+{]/u;

/**
 * Read an inert token as a plain atom.
 * @param token - An escape, a character class or an exact count.
 * @returns '' for an exact count, else one atom.
 */
function atomOf(token: string): string {
  return token.startsWith('{') ? '' : 'x';
}

/**
 * Fold the innermost group into one atom, then check the rest.
 * @param source - Pattern with inert tokens read as atoms.
 * @returns True when a repeated group holds a repeat.
 */
function isNested(source: string): boolean {
  const group = INNERMOST_GROUP.exec(source);
  if (group === null) return false;
  const isInnerRepeated = REPEAT.test(group[1]);
  const isGroupRepeated = group[2] !== '';
  if (isInnerRepeated && isGroupRepeated) return true;
  const atom = isInnerRepeated || isGroupRepeated ? 'x+' : 'x';
  const end = group.index + group[0].length;
  const folded = source.slice(0, group.index) + atom + source.slice(end);
  return isNested(folded);
}

/**
 * Whether a regex source repeats a group that holds a repeat.
 * @param pattern - Regex source.
 * @returns True for a nested quantifier.
 */
function hasNestedQuantifier(pattern: string): boolean {
  const source = pattern.replaceAll(INERT, atomOf);
  return isNested(source);
}

export default hasNestedQuantifier;
export { hasNestedQuantifier };
