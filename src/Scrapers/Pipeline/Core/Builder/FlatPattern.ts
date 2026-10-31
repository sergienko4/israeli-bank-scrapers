/**
 * FlatPattern — the regex grammar a config `pattern` or `valuePattern` may
 * use, so testing bank or caller text against it takes linear time. Between
 * `^` and `$` a flat pattern is a run of atoms — a literal, `.`, an escape or
 * a character class — each with an optional quantifier. It has no group and
 * no alternation, and at most one atom repeats a variable amount (`*`, `+`,
 * `?` or a range); every other quantifier is an exact `{n}`. Anchored at both
 * ends, such a pattern has one way to split its input per count of its one
 * variable atom, so a failed match costs input length × pattern length.
 */

/** `^`, then atoms each with an optional quantifier, then `$`. */
const FLAT =
  /^\^(?:(?:\\.|\[(?:\\.|[^\\\]])*\]|[^$()*+?[\\\]^{|}])(?:(?:[*+?]|\{\d+(?:,\d*)?\})\??)?)*\$$/u;

/** One atom and the quantifier after it ('' when it has none). */
const TOKEN =
  /(?:\\.|\[(?:\\.|[^\\\]])*\]|[^$()*+?[\\\]^{|}])((?:(?:[*+?]|\{\d+(?:,\d*)?\})\??)?)/gu;

/** An exact `{n}` count, lazy or not. */
const EXACT_COUNT = /^\{\d+\}\??$/u;

/**
 * Whether a quantifier repeats a variable amount.
 * @param quantifier - Quantifier after an atom, or ''.
 * @returns True for `*`, `+`, `?` or a range.
 */
function isVariable(quantifier: string): boolean {
  return quantifier !== '' && !EXACT_COUNT.test(quantifier);
}

/**
 * How many atoms of a flat pattern repeat a variable amount.
 * @param pattern - A pattern that already reads as flat.
 * @returns The number of variable quantifiers.
 */
function variableRepeats(pattern: string): number {
  const tokens = pattern.matchAll(TOKEN);
  const quantifiers = Array.from(tokens, (token): string => token[1]);
  return quantifiers.filter(isVariable).length;
}

/**
 * Whether a regex source is flat: anchored atoms, no group or alternation,
 * and at most one variable repeat.
 * @param pattern - Regex source.
 * @returns True for a flat pattern.
 */
function isFlatPattern(pattern: string): boolean {
  if (!FLAT.test(pattern)) return false;
  return variableRepeats(pattern) <= 1;
}

export default isFlatPattern;
export { isFlatPattern };
