/**
 * CurlCalls — every `curl` call in shell code, and whether it bounds its time.
 *
 * <p>Comment lines are dropped and continued lines joined, so one command is
 * one line. Every word `curl` outside a package install counts as a call,
 * wherever it sits in its command, so a continued, bare, wrapped or
 * substituted call cannot slip past. A bound counts only when every
 * occurrence of its option sets a positive number of seconds: curl reads 0
 * as no limit, and a value that is not a literal number cannot be checked.
 */

/** A shell or Dockerfile line continuation plus the next line's indent. */
const CONTINUATION_RE = /\\\n\s*/gu;
/** Where one shell command ends and the next begins within a line. */
const COMMAND_SPLIT_RE = /&&|\|\||[;|]/u;
/** A package install (single-spaced, as joined), whose arguments name packages. */
const PACKAGE_INSTALL_RE = /^(?:RUN )?(?:apt-get|apk)(?: -\S+)* (?:install|add) /u;
/** A curl call, from the word `curl` to the end of its command. */
const CURL_CALL_RE = /\bcurl\b.*/gu;

/** `--connect-timeout`: how long curl may wait for the connection. */
const CONNECT_BOUND = /--connect-timeout(?:=|\s+)(?<value>\S+)/gu;
/** `--max-time` or `-m`: how long the whole transfer may take. */
const TOTAL_BOUND = /(?<![\w-])(?:--max-time(?:=|\s+)|-m\s*)(?<value>\S+)/gu;

/**
 * The logical code lines of a Dockerfile or shell script: comment lines
 * dropped and continued lines joined, so one command is one line.
 *
 * @param text - The file.
 * @returns One trimmed, non-empty line per command.
 */
function logicalLines(text: string): readonly string[] {
  const lines = text.split('\n');
  const code = lines.filter(line => !line.trimStart().startsWith('#'));
  const joined = code.join('\n').replaceAll(CONTINUATION_RE, ' ');
  const trimmed = joined.split('\n').map(line => line.trim());
  return trimmed.filter(line => line !== '');
}

/**
 * Every curl call in some logical code lines. Any word `curl` outside a
 * package install counts, wherever it sits in its command, so a call after
 * `if`, inside `$(…)` or with a bare URL is not missed.
 *
 * @param lines - Logical code lines.
 * @returns Each call, up to the end of its command.
 */
function curlCallsIn(lines: readonly string[]): readonly string[] {
  const commands = lines.flatMap(line => line.split(COMMAND_SPLIT_RE));
  const trimmed = commands.map(command => command.trim());
  const runnable = trimmed.filter(command => !PACKAGE_INSTALL_RE.test(command));
  return runnable.flatMap(command => command.match(CURL_CALL_RE) ?? []);
}

/**
 * Whether a curl call sets a time bound, every time, to a positive number
 * of seconds.
 *
 * @param call - One curl call.
 * @param bound - {@link CONNECT_BOUND} or {@link TOTAL_BOUND}.
 * @returns True when bounded.
 */
function isBounded(call: string, bound: RegExp): boolean {
  const matches = [...call.matchAll(bound)];
  const seconds = matches.map(match => Number(match.groups?.value));
  const isPositive = seconds.every(value => Number.isFinite(value) && value > 0);
  return seconds.length > 0 && isPositive;
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
