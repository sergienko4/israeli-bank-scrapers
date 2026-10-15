/**
 * CurlCalls — every `curl` call in shell code, and whether it bounds its time.
 *
 * <p>Comments are dropped, both whole lines and a `#` that opens a word
 * outside quotes, and continued lines are joined, so one command is one line.
 * Each line is then read through its shell mask ({@link spanOf}), so text the
 * shell takes literally, quoted or escaped, never starts a call, ends a
 * command, closes a substitution or sets a bound. Every word `curl` outside a
 * package install starts a call, wherever it sits in its command, so a
 * continued, bare, wrapped or substituted call cannot slip past. A call runs
 * to the next `curl`, the end of its command, or the `)` or backtick that
 * closes its substitution, so no other text lends it a bound. A backtick
 * that opens a substitution inside the call does not end it. A quoted
 * program handed to a shell's `-c` or to `eval` is code too, so it is read
 * as a line of its own, as are the programs it hands on. A substitution in
 * a double-quoted program is read for both shells, which only repeats a
 * flag. A bound counts only when every occurrence of its option sets a
 * positive number of seconds, quoted or not, and no argument a wrapper
 * passes on follows it: curl reads 0 as no limit, a value that is not a
 * literal number cannot be checked, and curl keeps the last value given, so
 * a caller's `-m 0` passed on after the bound would lift it.
 */

import type { IShellSpan } from './ShellMask.js';
import { sliceSpan, spanOf, splitSpan, trimSpan } from './ShellMask.js';

/** A shell or Dockerfile line continuation plus the next line's indent. */
const CONTINUATION_RE = /\\\n\s*/gu;
/** Where one shell command ends and the next begins within a line. */
const COMMAND_SPLIT_RE = /&&|\|\||[;|]/gu;
/** A package install (single-spaced, as joined), whose arguments name packages. */
const PACKAGE_INSTALL_RE = /^(?:RUN )?(?:apt-get|apk)(?: -\S+)* (?:install|add) /u;
/** Before each word `curl`, except a `curl/…` agent string: where a call starts. */
const CALL_START_RE = /(?=\bcurl\b(?!\/))/gu;
/** A piece of a command that is a curl call. */
const CALL_HEAD_RE = /^curl\b(?!\/)/u;
/** An escape, a quoted string or, outside them, a comment to the end of the line. */
const COMMENT_RE = /\\.|'[^']*'|"(?:[^"\\]|\\.)*"|(?<!\S)#.*/gu;
/** A parenthesis in a mask, where backticks are parentheses too. */
const CLOSE_RE = /[()]/gu;
/** How each parenthesis moves the nesting depth. */
const DEPTH_STEP: Readonly<Record<string, number>> = { '(': 1, ')': -1 };
/** In a mask, a shell given `-c`, or `eval`, just before a quoted program. */
const PROGRAM_HEAD_RE =
  /(?<![\w-])(?:(?:(?:ba|da|k|z)?sh|su)(?:\s+[-+]\S+)*?\s+-[^\Wc]*c\w*|eval)\s+(?=_)/gu;
/** A quoted program at the start of some text; an unclosed one runs to the end. */
const QUOTED_PROGRAM_RE = /^(?:'(?<single>[^']*)|"(?<double>(?:[^"\\]|\\.)*))/u;
/** A backslash double quotes drop: the one before `\`, `"`, `$` or a backtick. */
const DOUBLE_ESCAPE_RE = /\\(?<kept>[\\"$`])/gu;
/** A bound's value in one pair of quotes. */
const QUOTED_VALUE_RE = /^(?<quote>['"])(?<inner>[^'"\s]*)\k<quote>$/u;

/** `--connect-timeout`: how long curl may wait for the connection. */
const CONNECT_BOUND = /--connect-timeout(?:=|\s+)(?<value>\S+)/dgu;
/** `--max-time` or `-m`: how long the whole transfer may take. */
const TOTAL_BOUND = /(?<![\w-])(?:--max-time(?:=|\s+)|-m\s*)(?<value>\S+)/dgu;
/** Arguments a wrapper passes on, `$@`, `$*` or a whole array, which may hold a bound. */
const FORWARDED_RE = /\$\{?(?:\w+\[)?[@*]/u;

/** A scan for the bracket that closes a call: depth below 0 once closed. */
interface ICloseScan {
  readonly depth: number;
  readonly end: number;
}

/**
 * A shell token with its comment, if it is one, removed.
 *
 * @param token - A {@link COMMENT_RE} match.
 * @returns '' for a comment, else the token unchanged.
 */
function dropComment(token: string): string {
  return token.startsWith('#') ? '' : token;
}

/**
 * The logical code lines of a Dockerfile or shell script: comments dropped
 * and continued lines joined, so one command is one line. Each physical line
 * is read for quotes on its own, so a stray quote misreads one line at most.
 *
 * @param text - The file.
 * @returns One trimmed, non-empty line per command.
 */
function logicalLines(text: string): readonly string[] {
  const lines = text.split('\n');
  const code = lines.filter(line => !line.trimStart().startsWith('#'));
  const uncommented = code.map(line => line.replaceAll(COMMENT_RE, dropComment));
  const joined = uncommented.join('\n').replaceAll(CONTINUATION_RE, ' ');
  const trimmed = joined.split('\n').map(line => line.trim());
  return trimmed.filter(line => line !== '');
}

/**
 * One step of the scan for a call's closing parenthesis.
 *
 * @param scan - The scan so far.
 * @param token - The next {@link CLOSE_RE} match in the call's mask.
 * @returns The scan after it; once closed, unchanged.
 */
function stepClose(scan: ICloseScan, token: RegExpExecArray): ICloseScan {
  if (scan.depth < 0) return scan;
  const depth = scan.depth + DEPTH_STEP[token[0]];
  return { depth, end: depth < 0 ? token.index : scan.end };
}

/**
 * A call cut where its substitution closes.
 *
 * @param call - From the word `curl` to the next call or the end of the command.
 * @returns The call, up to the first `)` or closing backtick it did not open.
 */
function closedCall(call: IShellSpan): IShellSpan {
  const tokens = [...call.mask.matchAll(CLOSE_RE)];
  const scan = tokens.reduce(stepClose, { depth: 0, end: call.mask.length });
  const closed = sliceSpan(call, 0, scan.end);
  return trimSpan(closed);
}

/**
 * The program a shell is handed just after `head`.
 *
 * @param line - A logical code line.
 * @param head - A {@link PROGRAM_HEAD_RE} match in the line's mask.
 * @returns The program's text as that shell reads it; '' when not quoted.
 */
function programAt(line: string, head: RegExpExecArray): string {
  const rest = line.slice(head.index + head[0].length);
  const quoted = QUOTED_PROGRAM_RE.exec(rest);
  const double = quoted?.groups?.double ?? '';
  const unescaped = double.replaceAll(DOUBLE_ESCAPE_RE, '$<kept>');
  return quoted?.groups?.single ?? unescaped;
}

/**
 * A logical code line and every program it hands a shell, in turn.
 *
 * @param line - A logical code line.
 * @returns The line, then each program's own logical lines, nested ones included.
 */
function withPrograms(line: string): readonly string[] {
  const { mask } = spanOf(line);
  const heads = [...mask.matchAll(PROGRAM_HEAD_RE)];
  const programs = heads.map(head => programAt(line, head));
  const programLines = programs.flatMap(program => logicalLines(program));
  return [line, ...programLines.flatMap(withPrograms)];
}

/**
 * Every curl call in some logical code lines, with its mask.
 *
 * @param lines - Logical code lines.
 * @returns Each call, up to the next call, the end of its command or its close.
 */
function callSpansIn(lines: readonly string[]): readonly IShellSpan[] {
  const code = lines.flatMap(withPrograms);
  const spans = code.map(line => spanOf(line));
  const commands = spans.flatMap(span => splitSpan(span, COMMAND_SPLIT_RE));
  const trimmed = commands.map(command => trimSpan(command));
  const runnable = trimmed.filter(command => !PACKAGE_INSTALL_RE.test(command.text));
  const pieces = runnable.flatMap(command => splitSpan(command, CALL_START_RE));
  const calls = pieces.filter(piece => CALL_HEAD_RE.test(piece.mask));
  return calls.map(closedCall);
}

/**
 * Every curl call in some logical code lines. Any word `curl` outside a
 * package install and outside quotes counts, wherever it sits in its
 * command, so a call after `if`, inside `$(…)` or with a bare URL is not
 * missed.
 *
 * @param lines - Logical code lines.
 * @returns Each call's text, up to the next call, the end of its command or its close.
 */
function curlCallsIn(lines: readonly string[]): readonly string[] {
  const calls = callSpansIn(lines);
  return calls.map(call => call.text);
}

/**
 * The seconds one bound sets, its value read from the call's text with one
 * pair of quotes around it dropped.
 *
 * @param call - One curl call.
 * @param match - A bound's match in the call's mask.
 * @returns The seconds; NaN or 0 when the value is not a positive literal.
 */
function secondsOf(call: IShellSpan, match: RegExpExecArray): number {
  const [start, end] = match.indices?.groups?.value ?? [0, 0];
  const value = call.text.slice(start, end);
  const literal = value.replace(QUOTED_VALUE_RE, '$<inner>');
  return Number(literal);
}

/**
 * Whether a curl call sets a time bound, every time, to a positive number
 * of seconds, with no passed-on arguments after the last one. Both are found
 * in the mask, so quoted text neither sets a bound nor hides `"$@"`.
 *
 * @param call - One curl call.
 * @param bound - {@link CONNECT_BOUND} or {@link TOTAL_BOUND}.
 * @returns True when bounded.
 */
function isBounded(call: IShellSpan, bound: RegExp): boolean {
  const matches = [...call.mask.matchAll(bound)];
  const seconds = matches.map(match => secondsOf(call, match));
  const isPositive = seconds.every(value => Number.isFinite(value) && value > 0);
  const last = matches.at(-1)?.index ?? 0;
  const tail = call.mask.slice(last);
  const isFinal = !FORWARDED_RE.test(tail);
  return seconds.length > 0 && isPositive && isFinal;
}

/**
 * The curl calls in some logical code lines that miss any of `bounds`.
 *
 * @param lines - Logical code lines.
 * @param bounds - Bounds every call must set.
 * @returns Each call missing one.
 */
function unboundedCalls(lines: readonly string[], bounds: readonly RegExp[]): readonly string[] {
  const calls = callSpansIn(lines);
  const unbounded = calls.filter(call => !bounds.every(bound => isBounded(call, bound)));
  return unbounded.map(call => call.text);
}

export { CONNECT_BOUND, curlCallsIn, logicalLines, TOTAL_BOUND, unboundedCalls };
