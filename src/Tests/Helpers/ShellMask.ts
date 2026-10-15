/**
 * ShellMask — shell code with the text the shell takes literally masked out.
 *
 * <p>A mask has its code's length, so an index found in the mask is the same
 * index in the code. Quoted text, escapes and the quotes themselves become
 * `_`, so a `curl`, `;`, `|` or `-m 5` inside them never reads as code. Inside
 * double quotes a `$(…)` substitution and a parameter expansion (`$x`, `${x}`,
 * `$@`) stay, as the shell still runs and expands them there. A backtick
 * becomes `(` where it opens a substitution and `)` where it closes one, so
 * both kinds of substitution nest as parentheses.
 */

/** Where the lexer is: plain code, `( … )`, backticks, or a quoted string. */
type Frame = 'code' | 'paren' | 'tick' | 'double' | 'single';
/** What a lexeme becomes in the mask: itself, `_`s, or a parenthesis for a backtick. */
type Emit = 'keep' | 'mask' | '(' | ')';
/** Whether a lexeme keeps, leaves or enters a frame. */
type Move = 'stay' | 'pop' | Frame;
/** Each kind of lexeme. */
type Kind =
  | 'escapedQuote'
  | 'escape'
  | 'single'
  | 'double'
  | 'subst'
  | 'open'
  | 'close'
  | 'tick'
  | 'expansion'
  | 'text';

/** One lexeme per match, every character covered; a lone `\` or `$` is one character. */
const LEXEME_RE = /\\[\s\S]|\$\(|\$(?:\{[^}]*\}|\w+|[@*#?$!-])|['"`()\\$]|[^\\'"$()`]+/gu;

/** The kind of a lexeme, by the first pattern it matches; anything else is text. */
const KIND_PATTERNS: readonly (readonly [RegExp, Kind])[] = [
  [/^\\'$/u, 'escapedQuote'],
  [/^\\./su, 'escape'],
  [/^'$/u, 'single'],
  [/^"$/u, 'double'],
  [/^\$\($/u, 'subst'],
  [/^\($/u, 'open'],
  [/^\)$/u, 'close'],
  [/^`$/u, 'tick'],
  [/^\$./su, 'expansion'],
];

/** What the lexer does with a lexeme in a frame. */
interface IStep {
  readonly emit: Emit;
  readonly move: Move;
}

const KEEP: IStep = { emit: 'keep', move: 'stay' };
const MASK: IStep = { emit: 'mask', move: 'stay' };
const LEAVE_QUOTE: IStep = { emit: 'mask', move: 'pop' };
const ENTER_SUBST: IStep = { emit: 'keep', move: 'paren' };
const ENTER_TICK: IStep = { emit: '(', move: 'tick' };

/** Steps in code; a `)` or backtick that closes nothing it opened stays as is. */
const CODE_STEPS: Readonly<Record<Kind, IStep>> = {
  escapedQuote: MASK,
  escape: MASK,
  single: { emit: 'mask', move: 'single' },
  double: { emit: 'mask', move: 'double' },
  subst: ENTER_SUBST,
  open: ENTER_SUBST,
  close: KEEP,
  tick: ENTER_TICK,
  expansion: KEEP,
  text: KEEP,
};

/** Steps inside double quotes: substitutions and expansions stay, the rest is literal. */
const DOUBLE_STEPS: Readonly<Record<Kind, IStep>> = {
  escapedQuote: MASK,
  escape: MASK,
  single: MASK,
  double: LEAVE_QUOTE,
  subst: ENTER_SUBST,
  open: MASK,
  close: MASK,
  tick: ENTER_TICK,
  expansion: KEEP,
  text: MASK,
};

/** Steps inside single quotes: all literal, a backslash too, up to the next `'`. */
const SINGLE_STEPS: Readonly<Record<Kind, IStep>> = {
  ...DOUBLE_STEPS,
  escapedQuote: LEAVE_QUOTE,
  single: LEAVE_QUOTE,
  double: MASK,
  subst: MASK,
  tick: MASK,
  expansion: MASK,
};

/** The steps of each frame. */
const STEPS: Readonly<Record<Frame, Readonly<Record<Kind, IStep>>>> = {
  code: CODE_STEPS,
  paren: { ...CODE_STEPS, close: { emit: 'keep', move: 'pop' } },
  tick: { ...CODE_STEPS, tick: { emit: ')', move: 'pop' } },
  double: DOUBLE_STEPS,
  single: SINGLE_STEPS,
};

/** The lexer between lexemes: its open frames and the mask so far. */
interface ILexState {
  readonly frames: readonly Frame[];
  readonly mask: string;
}

/** Shell code and its mask, cut together. */
interface IShellSpan {
  readonly text: string;
  readonly mask: string;
}

/**
 * What a lexeme writes into the mask.
 *
 * @param emit - The step's emit.
 * @param lexeme - The lexeme.
 * @returns Text of the lexeme's length.
 */
function emitted(emit: Emit, lexeme: string): string {
  if (emit === 'keep') return lexeme;
  if (emit === 'mask') return '_'.repeat(lexeme.length);
  return emit;
}

/**
 * The kind of a lexeme.
 *
 * @param lexeme - The lexeme.
 * @returns Its kind, by {@link KIND_PATTERNS}.
 */
function kindOf(lexeme: string): Kind {
  const found = KIND_PATTERNS.find(([pattern]) => pattern.test(lexeme));
  return found ? found[1] : 'text';
}

/**
 * The frames after a move.
 *
 * @param frames - Open frames, innermost last.
 * @param move - The step's move.
 * @returns The frames it leaves open.
 */
function movedFrames(frames: readonly Frame[], move: Move): readonly Frame[] {
  if (move === 'stay') return frames;
  if (move === 'pop') return frames.slice(0, -1);
  return [...frames, move];
}

/**
 * One lexeme through the lexer.
 *
 * @param state - The lexer so far.
 * @param lexeme - The next {@link LEXEME_RE} match.
 * @returns The lexer after it.
 */
function stepLexeme(state: ILexState, lexeme: RegExpExecArray): ILexState {
  const frame = state.frames.at(-1) ?? 'code';
  const [text] = lexeme;
  const kind = kindOf(text);
  const step = STEPS[frame][kind];
  const piece = emitted(step.emit, text);
  const frames = movedFrames(state.frames, step.move);
  return { frames, mask: state.mask + piece };
}

/**
 * Shell code as a span with its mask.
 *
 * @param text - One logical line of shell code.
 * @returns The line and its mask, the same length.
 */
function spanOf(text: string): IShellSpan {
  const lexemes = [...text.matchAll(LEXEME_RE)];
  const start: ILexState = { frames: ['code'], mask: '' };
  const { mask } = lexemes.reduce(stepLexeme, start);
  return { text, mask };
}

/**
 * A span cut at the same indices in its text and its mask.
 *
 * @param span - The span.
 * @param start - First index kept.
 * @param end - First index dropped.
 * @returns The cut span.
 */
function sliceSpan(span: IShellSpan, start: number, end: number): IShellSpan {
  return { text: span.text.slice(start, end), mask: span.mask.slice(start, end) };
}

/**
 * A span without the whitespace around its code.
 *
 * @param span - The span.
 * @returns The trimmed span.
 */
function trimSpan(span: IShellSpan): IShellSpan {
  const start = span.mask.length - span.mask.trimStart().length;
  const end = span.mask.trimEnd().length;
  const kept = Math.max(start, end);
  return sliceSpan(span, start, kept);
}

/**
 * A span split where its mask matches a separator, the separator dropped.
 *
 * @param span - The span.
 * @param separator - A global pattern; a zero-width one splits before its match.
 * @returns The pieces between separators, in order.
 */
function splitSpan(span: IShellSpan, separator: RegExp): readonly IShellSpan[] {
  const cuts = [...span.mask.matchAll(separator)];
  const after = cuts.map(cut => cut.index + cut[0].length);
  const before = cuts.map(cut => cut.index);
  const starts = [0, ...after];
  const ends = [...before, span.mask.length];
  return starts.map((start, at) => sliceSpan(span, start, ends[at]));
}

export type { IShellSpan };
export { sliceSpan, spanOf, splitSpan, trimSpan };
