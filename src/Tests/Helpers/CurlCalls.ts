/**
 * CurlCalls — every `curl` call in shell code, and whether it bounds its time.
 *
 * <p>Comments are dropped, both whole lines and a `#` that opens a word
 * outside quotes, and continued lines are joined, so one command is one line.
 * Every word `curl` outside a package install starts a call, wherever it sits
 * in its command, so a continued, bare, wrapped or substituted call cannot
 * slip past. A call runs to the next `curl`, the end of its command, or the
 * `)` or backtick that closes its substitution, so no other text lends it a
 * bound. A bound counts only when every occurrence of its option sets a
 * positive number of seconds, and no argument a wrapper passes on follows
 * it: curl reads 0 as no limit, a value that is not a literal number cannot
 * be checked, and curl keeps the last value given, so a caller's `-m 0`
 * passed on after the bound would lift it.
 */

/** A shell or Dockerfile line continuation plus the next line's indent. */
const CONTINUATION_RE = /\\\n\s*/gu;
/** Where one shell command ends and the next begins within a line. */
const COMMAND_SPLIT_RE = /&&|\|\||[;|]/u;
/** A package install (single-spaced, as joined), whose arguments name packages. */
const PACKAGE_INSTALL_RE = /^(?:RUN )?(?:apt-get|apk)(?: -\S+)* (?:install|add) /u;
/** Before each word `curl`, except a `curl/…` agent string: where a call starts. */
const CALL_START_RE = /(?=\bcurl\b(?!\/))/u;
/** A piece of a command that is a curl call. */
const CALL_HEAD_RE = /^curl\b(?!\/)/u;
/** An escape, a quoted string or, outside them, a comment to the end of the line. */
const COMMENT_RE = /\\.|'[^']*'|"(?:[^"\\]|\\.)*"|(?<!\S)#.*/gu;
/** An escape, a quoted string or, outside them, a parenthesis or a backtick. */
const CLOSE_RE = /\\.|'[^']*'|"(?:[^"\\]|\\.)*"|[()`]/gu;
/** How each bracket moves the nesting depth; a backtick always closes. */
const DEPTH_STEP: Readonly<Record<string, number>> = { '(': 1, ')': -1, '`': -Infinity };

/** `--connect-timeout`: how long curl may wait for the connection. */
const CONNECT_BOUND = /--connect-timeout(?:=|\s+)(?<value>\S+)/gu;
/** `--max-time` or `-m`: how long the whole transfer may take. */
const TOTAL_BOUND = /(?<![\w-])(?:--max-time(?:=|\s+)|-m\s*)(?<value>\S+)/gu;
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
 * One step of the scan for a call's closing bracket.
 *
 * @param scan - The scan so far.
 * @param token - The next {@link CLOSE_RE} match.
 * @returns The scan after it; once closed, unchanged.
 */
function stepClose(scan: ICloseScan, token: RegExpExecArray): ICloseScan {
  const [text] = token;
  if (scan.depth < 0 || !Object.hasOwn(DEPTH_STEP, text)) return scan;
  const depth = scan.depth + DEPTH_STEP[text];
  return { depth, end: depth < 0 ? token.index : scan.end };
}

/**
 * A call cut where its substitution closes.
 *
 * @param call - From the word `curl` to the next call or the end of the command.
 * @returns The call, up to the first `)` or backtick it did not open.
 */
function closedCall(call: string): string {
  const tokens = [...call.matchAll(CLOSE_RE)];
  const scan = tokens.reduce(stepClose, { depth: 0, end: call.length });
  return call.slice(0, scan.end).trimEnd();
}

/**
 * Every curl call in some logical code lines. Any word `curl` outside a
 * package install counts, wherever it sits in its command, so a call after
 * `if`, inside `$(…)` or with a bare URL is not missed.
 *
 * @param lines - Logical code lines.
 * @returns Each call, up to the next call, the end of its command or its close.
 */
function curlCallsIn(lines: readonly string[]): readonly string[] {
  const commands = lines.flatMap(line => line.split(COMMAND_SPLIT_RE));
  const trimmed = commands.map(command => command.trim());
  const runnable = trimmed.filter(command => !PACKAGE_INSTALL_RE.test(command));
  const pieces = runnable.flatMap(command => command.split(CALL_START_RE));
  const calls = pieces.filter(piece => CALL_HEAD_RE.test(piece));
  return calls.map(closedCall);
}

/**
 * Whether a curl call sets a time bound, every time, to a positive number
 * of seconds, with no passed-on arguments after the last one.
 *
 * @param call - One curl call.
 * @param bound - {@link CONNECT_BOUND} or {@link TOTAL_BOUND}.
 * @returns True when bounded.
 */
function isBounded(call: string, bound: RegExp): boolean {
  const matches = [...call.matchAll(bound)];
  const seconds = matches.map(match => Number(match.groups?.value));
  const isPositive = seconds.every(value => Number.isFinite(value) && value > 0);
  const last = matches.at(-1)?.index ?? 0;
  const tail = call.slice(last);
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
  const calls = curlCallsIn(lines);
  return calls.filter(call => !bounds.every(bound => isBounded(call, bound)));
}

export { CONNECT_BOUND, curlCallsIn, logicalLines, TOTAL_BOUND, unboundedCalls };
