/**
 * Handoff script lexer (N54) — splits a page script into the tokens the
 * handoff walker reads: names, numbers, quoted strings, template literals and
 * one-char punctuators. Whitespace and `//` and block comments are dropped; a
 * line break among them marks the next token as starting a line, which ends
 * a statement with no `;`. An unterminated comment, string or template, or a
 * template holding `${`, refuses the script. Regex literals are not read: a
 * `/` is punctuation, so a script holding one is refused by the walker.
 */

/** What a token is; `end` stands past the last token and is never lexed. */
type ScriptTokenKind = 'name' | 'number' | 'string' | 'template' | 'punct' | 'end';

/** One token; a string or template holds its text without the quotes. */
interface IScriptToken {
  readonly kind: ScriptTokenKind;
  readonly text: string;
  readonly isLineStart: boolean;
}

/** How one lexeme starts, what it must span, and what it is. */
interface IScanRule {
  readonly starts: RegExp;
  readonly whole: RegExp;
  readonly kind: ScriptTokenKind | 'trivia';
}

/** Where the lexer stands. */
interface ILexCursor {
  at: number;
  isLineStart: boolean;
  isRefused: boolean;
  readonly tokens: IScriptToken[];
}

const LINE_BREAK = /[\n\r\u2028\u2029]/;
const JS_ESCAPE = /\\([\s\S])/g;
const PLAIN_ESCAPES = new Set(['/', '\\', "'", '"']);
const QUOTED_KINDS = new Set<IScanRule['kind']>(['string', 'template']);
const PUNCT_RULE: IScanRule = { starts: /[\s\S]/y, whole: /[\s\S]/y, kind: 'punct' };

/** Lexeme rules, first match wins; punctuation takes any other char. */
const SCAN_RULES: readonly IScanRule[] = [
  { starts: /\s/y, whole: /\s+/y, kind: 'trivia' },
  { starts: /\/\//y, whole: /\/\/[^\n\r\u2028\u2029]*/y, kind: 'trivia' },
  { starts: /\/\*/y, whole: /\/\*[\s\S]*?\*\//y, kind: 'trivia' },
  { starts: /'/y, whole: /'(?:[^'\\\n\r]|\\[\s\S])*'/y, kind: 'string' },
  { starts: /"/y, whole: /"(?:[^"\\\n\r]|\\[\s\S])*"/y, kind: 'string' },
  { starts: /`/y, whole: /`(?:[^`\\$]|\\[\s\S]|\$(?!\{))*`/y, kind: 'template' },
  { starts: /[a-z_$]/iy, whole: /[a-z_$][\w$]*/iy, kind: 'name' },
  { starts: /\d/y, whole: /\d[\w.]*/y, kind: 'number' },
];

/**
 * Where a sticky pattern's match from `at` ends.
 * @param pattern - Sticky regex.
 * @param source - Script text.
 * @param at - Start index.
 * @returns End index, or -1 when it does not match there.
 */
function stickyEnd(pattern: RegExp, source: string, at: number): number {
  pattern.lastIndex = at;
  const match = pattern.exec(source);
  return match === null ? -1 : at + match[0].length;
}

/**
 * The rule of the lexeme at `at`.
 * @param source - Script text.
 * @param at - Start index.
 * @returns The first rule whose start matches there, else punctuation.
 */
function ruleAt(source: string, at: number): IScanRule {
  const found = SCAN_RULES.find((rule): boolean => stickyEnd(rule.starts, source, at) >= 0);
  return found ?? PUNCT_RULE;
}

/**
 * Keep trivia: a line break in it marks the next token as starting a line.
 * @param cursor - Lexer cursor.
 * @param lexeme - Whitespace or a comment.
 * @returns True once kept.
 */
function keepTrivia(cursor: ILexCursor, lexeme: string): boolean {
  cursor.isLineStart ||= LINE_BREAK.test(lexeme);
  return true;
}

/**
 * Keep one lexeme: trivia notes a line break, any other becomes a token.
 * A line break inside a token (a template's) does not start a line.
 * @param cursor - Lexer cursor.
 * @param kind - The lexeme's kind.
 * @param lexeme - Its text.
 * @returns True once kept.
 */
function keepLexeme(cursor: ILexCursor, kind: IScanRule['kind'], lexeme: string): boolean {
  if (kind === 'trivia') return keepTrivia(cursor, lexeme);
  const text = QUOTED_KINDS.has(kind) ? lexeme.slice(1, -1) : lexeme;
  cursor.tokens.push({ kind, text, isLineStart: cursor.isLineStart });
  cursor.isLineStart = false;
  return true;
}

/**
 * Read the lexeme at the cursor, refusing one that starts but never ends.
 * @param cursor - Lexer cursor.
 * @param source - Script text.
 * @returns False when the script is refused.
 */
function lexStep(cursor: ILexCursor, source: string): boolean {
  const rule = ruleAt(source, cursor.at);
  const end = stickyEnd(rule.whole, source, cursor.at);
  cursor.isRefused = end < 0;
  if (cursor.isRefused) return false;
  const lexeme = source.slice(cursor.at, end);
  cursor.at = end;
  return keepLexeme(cursor, rule.kind, lexeme);
}

/**
 * Split a script into tokens.
 * @param source - Script text.
 * @returns Its tokens, or false when it is refused.
 */
function tokenizeScript(source: string): readonly IScriptToken[] | false {
  const cursor: ILexCursor = { at: 0, isLineStart: true, isRefused: false, tokens: [] };
  while (!cursor.isRefused && cursor.at < source.length) lexStep(cursor, source);
  return !cursor.isRefused && cursor.tokens;
}

/**
 * Decode a quoted string's text, allowing only the escapes `\/`, `\\`, `\'`
 * and `\"`.
 * @param raw - The text between the quotes.
 * @returns The decoded text, or false for any other escape.
 */
function decodeJsString(raw: string): string | false {
  const escapes = [...raw.matchAll(JS_ESCAPE)];
  if (!escapes.every((found): boolean => PLAIN_ESCAPES.has(found[1]))) return false;
  return raw.replaceAll(JS_ESCAPE, '$1');
}

export type { IScriptToken, ScriptTokenKind };
export { decodeJsString, tokenizeScript };
