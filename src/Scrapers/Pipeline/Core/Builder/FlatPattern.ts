/**
 * FlatPattern — the regex grammar a config `pattern` or `valuePattern` may
 * use, so testing bank or caller text against it takes linear time. Between
 * `^` and `$` a flat pattern is a run of atoms — a literal, `.`, an escape or
 * a character class — each with an optional quantifier. It has no group and
 * no alternation, and only its last atom may repeat a variable amount (`*`,
 * `+`, `?` or a range); every earlier quantifier is an exact `{n}`. The
 * earlier atoms then match one way, and each count the last atom backs off
 * to costs only the `$` check, so a failed match is linear in the input.
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
 * The quantifier of each atom of a flat pattern, in order.
 * @param pattern - A pattern that already reads as flat.
 * @returns One quantifier per atom ('' when it has none).
 */
function quantifiersOf(pattern: string): readonly string[] {
  const tokens = pattern.matchAll(TOKEN);
  return Array.from(tokens, (token): string => token[1]);
}

/**
 * Whether a regex source is flat: anchored atoms, no group or alternation,
 * and a variable repeat on the last atom only.
 * @param pattern - Regex source.
 * @returns True for a flat pattern.
 */
function isFlatPattern(pattern: string): boolean {
  if (!FLAT.test(pattern)) return false;
  const quantifiers = quantifiersOf(pattern);
  const leading = quantifiers.slice(0, -1);
  return !leading.some(isVariable);
}

export default isFlatPattern;
export { isFlatPattern };
