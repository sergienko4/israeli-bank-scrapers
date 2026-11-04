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

/** A whole escape; Unicode braces belong to the atom, not its quantifier. */
const ESCAPE = /\\(?:u\{[\da-fA-F]+\}|u[\da-fA-F]{4}|x[\da-fA-F]{2}|c[A-Za-z]|[pP]\{[^}]+\}|.)/uy;

/** A class keeps escaped closing brackets inside the atom. */
const CHARACTER_CLASS = /\[(?:\\.|[^\\\]])*\]/uy;

/** A literal or dot, excluding anchors, grouping and quantifier syntax. */
const LITERAL = /[^$()*+?[\\\]^{|}]/uy;

/** One complete quantifier, including its optional lazy marker. */
const QUANTIFIER = /(?:[*+?]|\{\d+(?:,\d*)?\})\??/uy;

const ATOM_BY_PREFIX: Readonly<Partial<Record<string, RegExp>>> = {
  '\\': ESCAPE,
  '[': CHARACTER_CLASS,
};

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
 * Read only at the cursor; never search later positions after a failed token.
 * @param matcher - Sticky token expression.
 * @param pattern - Regex source.
 * @param index - Current cursor.
 * @returns The token text, or '' when absent.
 */
function readAt(matcher: RegExp, pattern: string, index: number): string {
  matcher.lastIndex = index;
  return matcher.exec(pattern)?.[0] ?? '';
}

/**
 * Advance over one atom and its quantifier without revisiting earlier text.
 * @param pattern - Regex source.
 * @param index - Atom start.
 * @returns The next cursor, or -1 for a bad atom or a leading variable repeat.
 */
function advance(pattern: string, index: number): number {
  const matcher = ATOM_BY_PREFIX[pattern[index]] ?? LITERAL;
  const atom = readAt(matcher, pattern, index);
  if (atom === '') return -1;
  const quantifierStart = index + atom.length;
  const quantifier = readAt(QUANTIFIER, pattern, quantifierStart);
  const next = quantifierStart + quantifier.length;
  if (isVariable(quantifier) && next !== pattern.length - 1) return -1;
  return next;
}

/**
 * Whether a regex source is flat: anchored atoms, no group or alternation,
 * and a variable repeat on the last atom only.
 * @param pattern - Regex source.
 * @returns True for a flat pattern.
 */
function isFlatPattern(pattern: string): boolean {
  if (!pattern.startsWith('^') || !pattern.endsWith('$')) return false;
  let index = 1;
  const end = pattern.length - 1;
  while (index > 0 && index < end) index = advance(pattern, index);
  return index === end;
}

export default isFlatPattern;
export { isFlatPattern };
