/**
 * NestedQuantifier — a build-time guard against catastrophic backtracking in
 * a configured regex. A group repeated by any quantifier — `*`, `+`, a range
 * or even an exact `{n}` — that itself holds a variable repeat, at any depth,
 * can make a match take exponential or high-polynomial time, so a config
 * naming one fails the build. Escapes and character classes are read as plain
 * atoms first, and an exact `{n}` after an atom is dropped: it never repeats
 * a variable amount. Overlapping alternatives such as `(a|a)*` are not
 * detected; configured patterns stay simple and reviewed.
 */

/** Text read as one atom: an escape or a character class. */
const INERT = /\\.|\[(?:\\.|[^\]\\])*\]/gu;

/** An exact `{n}` count after an atom rather than after a group. */
const ATOM_COUNT = /(?<!\))\{\d+\}/gu;

/** The leftmost group with no group inside, and the quantifier after it. */
const INNERMOST_GROUP = /\(([^()]*)\)((?:\{\d+(?:,\d*)?\}|[*+])?)/u;

/** A quantifier that repeats a variable number of times. */
const REPEAT = /[*+{]/u;

/** An exact `{n}` count. */
const EXACT_COUNT = /^\{\d+\}$/u;

/**
 * The atom a folded group reads as.
 * @param isInnerRepeated - Whether the group body repeats.
 * @param quantifier - The quantifier after the group, or ''.
 * @returns 'x+' when the group matches a variable width, else 'x'.
 */
function foldedAtom(isInnerRepeated: boolean, quantifier: string): string {
  const isVariable = quantifier !== '' && !EXACT_COUNT.test(quantifier);
  return isInnerRepeated || isVariable ? 'x+' : 'x';
}

/**
 * Fold the innermost group into one atom, then check the rest.
 * @param source - Pattern with inert tokens read as atoms.
 * @returns True when a repeated group holds a repeat.
 */
function isNested(source: string): boolean {
  const group = INNERMOST_GROUP.exec(source);
  if (group === null) return false;
  const [, body, quantifier] = group;
  const isInnerRepeated = REPEAT.test(body);
  if (isInnerRepeated && quantifier !== '') return true;
  const atom = foldedAtom(isInnerRepeated, quantifier);
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
  const atoms = pattern.replaceAll(INERT, 'x');
  const source = atoms.replaceAll(ATOM_COUNT, '');
  return isNested(source);
}

export default hasNestedQuantifier;
export { hasNestedQuantifier };
