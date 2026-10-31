/**
 * NestedQuantifier — a build-time guard against catastrophic backtracking in
 * a configured regex. A group repeated by `*`, `+`, a range or even an exact
 * `{n}` that itself holds a variable-width part — `*`, `+`, `?` or a range,
 * at any depth — can make a match take exponential or high-polynomial time,
 * so a config naming one fails the build. Escapes and character classes are
 * read as plain atoms first, group openers such as `(?:` lose their `?`, and
 * an exact `{n}` after an atom is dropped: it never repeats a variable
 * amount. A `?` on a group makes it variable-width but is no loop, so
 * `(-\d+)?` passes. Overlapping alternatives such as `(a|a)*` are not
 * detected; configured patterns stay simple and reviewed.
 */

/** Text read as one atom: an escape or a character class. */
const INERT = /\\.|\[(?:\\.|[^\]\\])*\]/gu;

/** A group opener's syntax: `(?:`, a lookaround or a named group. */
const GROUP_OPENER = /\(\?(?:[:=!]|<[=!]|<[^>]*>)/gu;

/** An exact `{n}` count after an atom rather than after a group. */
const ATOM_COUNT = /(?<!\))\{\d+\}\??/gu;

/** The leftmost group with no group inside, and the quantifier after it. */
const INNERMOST_GROUP = /\(([^()]*)\)((?:(?:[*+?]|\{\d+(?:,\d*)?\})\??)?)/u;

/** A quantifier that matches a variable width. */
const VARIABLE = /[*+?{]/u;

/** A quantifier that loops: anything but an optional `?`. */
const LOOP = /^[*+{]/u;

/** An exact `{n}` count. */
const EXACT_COUNT = /^\{\d+\}\??$/u;

/**
 * The atom a folded group reads as.
 * @param isInnerVariable - Whether the group body is variable-width.
 * @param quantifier - The quantifier after the group, or ''.
 * @returns 'x+' when the group matches a variable width, else 'x'.
 */
function foldedAtom(isInnerVariable: boolean, quantifier: string): string {
  const isVariable = quantifier !== '' && !EXACT_COUNT.test(quantifier);
  return isInnerVariable || isVariable ? 'x+' : 'x';
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
  const isInnerVariable = VARIABLE.test(body);
  if (isInnerVariable && LOOP.test(quantifier)) return true;
  const atom = foldedAtom(isInnerVariable, quantifier);
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
  const atoms = pattern.replaceAll(INERT, 'x').replaceAll(GROUP_OPENER, '(');
  const source = atoms.replaceAll(ATOM_COUNT, '');
  return isNested(source);
}

export default hasNestedQuantifier;
export { hasNestedQuantifier };
