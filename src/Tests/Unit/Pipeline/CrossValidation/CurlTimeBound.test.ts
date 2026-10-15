/**
 * Curl time bound — every curl call the repo runs bounds its total time.
 *
 * <p>curl waits forever by default: a peer that accepts the connection and
 * then stalls holds the step until the job's own timeout, which on most jobs
 * is hours away. So every curl call in a tracked shell script, git hook,
 * Dockerfile or workflow / composite-action `run:` step must set a positive
 * `--max-time` (or `-m`). A wrapper that passes its arguments on must set
 * its bound after them: curl keeps the last value given, so a bound placed
 * before them lets a caller's `-m 0` lift it. The installer and its Docker mirror are held to
 * the stricter connect-and-total rule by `InstallCamoufoxWiring`.
 *
 * <p>Test harnesses under a `tests/` directory are skipped: they replace curl
 * with a stub, which CTB-5 checks.
 */

import { parse } from 'yaml';

import {
  curlCallsIn,
  logicalLines,
  TOTAL_BOUND,
  unboundedCalls,
} from '../../../Helpers/CurlCalls.js';
import { readRepoFile, trackedFiles } from '../../../Helpers/RepoFiles.js';

/** The bound every call must set. */
const BOUNDS: readonly RegExp[] = [TOTAL_BOUND];

/** A shell script, or a git hook (an extensionless file directly in `.husky/`). */
const SHELL_FILE_RE = /(?:\.sh|^\.husky\/[\w-]+)$/u;
/** A Dockerfile, whatever its suffix. */
const DOCKERFILE_RE = /(?:^|\/)Dockerfile[^/]*$/u;
/** A workflow or composite-action file. */
const ACTIONS_YAML_RE = /^\.github\/.+\.ya?ml$/u;
/** A file in a test harness directory. */
const HARNESS_RE = /(?:^|\/)tests\//u;
/** A shell function named `curl`, defined at the start of a line. */
const CURL_FUNCTION_RE = /^\s*curl\(\)\s*\{/mu;
/** A PATH executable named `curl`, anywhere in the text. */
const CURL_BINARY_RE = /\/bin\/curl\b/u;
/** Each way a harness replaces the real curl with a stub. */
const CURL_STUBS: readonly RegExp[] = [CURL_FUNCTION_RE, CURL_BINARY_RE];

/** One file's curl calls. */
interface IFileCalls {
  readonly path: string;
  readonly lines: readonly string[];
}

/**
 * Every `run:` script in a parsed workflow or action, at any depth.
 *
 * @param node - A parsed YAML value.
 * @returns The scripts, in document order.
 */
function runScripts(node: unknown): readonly string[] {
  if (typeof node !== 'object' || node === null) return [];
  const entries = Object.entries(node);
  return entries.flatMap(([key, value]) =>
    key === 'run' && typeof value === 'string' ? [value] : runScripts(value),
  );
}

/**
 * The logical code lines of the `run:` scripts in a workflow or action.
 *
 * @param text - The YAML file.
 * @returns One trimmed line per command.
 */
function yamlCode(text: string): readonly string[] {
  const doc = parse(text) as unknown;
  const scripts = runScripts(doc);
  return scripts.flatMap(script => logicalLines(script));
}

/**
 * The logical code lines of a tracked file that runs commands.
 *
 * @param path - Repo-relative path.
 * @returns One trimmed line per command; none for a file that runs none.
 */
function codeOf(path: string): readonly string[] {
  const isShell = SHELL_FILE_RE.test(path) || DOCKERFILE_RE.test(path);
  const isYaml = ACTIONS_YAML_RE.test(path);
  if (!isShell && !isYaml) return [];
  const text = readRepoFile(path);
  return isYaml ? yamlCode(text) : logicalLines(text);
}

/**
 * Every tracked file that runs commands, with its code.
 *
 * @returns One entry per file.
 */
function scannedFiles(): readonly IFileCalls[] {
  const paths = trackedFiles();
  const scanned = paths.map(path => ({ path, lines: codeOf(path) }));
  return scanned.filter(file => file.lines.length > 0);
}

const SCANNED = scannedFiles();
const PRODUCTION = SCANNED.filter(file => !HARNESS_RE.test(file.path));
const HARNESSES = SCANNED.filter(file => HARNESS_RE.test(file.path));

/**
 * The files among some that make at least one curl call.
 *
 * @param files - Scanned files.
 * @returns Their repo-relative paths.
 */
function filesCallingCurl(files: readonly IFileCalls[]): readonly string[] {
  const calling = files.filter(file => curlCallsIn(file.lines).length > 0);
  return calling.map(file => file.path);
}

/**
 * A file's unbounded curl calls, each prefixed with the file's path.
 *
 * @param file - A scanned file.
 * @returns One `path: call` entry per unbounded call.
 */
function offendersIn(file: IFileCalls): readonly string[] {
  const unbounded = unboundedCalls(file.lines, BOUNDS);
  return unbounded.map(call => `${file.path}: ${call}`);
}

/** One file of each kind the scan reads, each known to call curl. */
const KNOWN_CALLERS = [
  '.github/workflows/pr.yml',
  'docker/Dockerfile.ci-mirror',
  '.github/actions/install-camoufox/install.sh',
] as const;

/** Calls the oracle must flag, each next to a bounded call. */
const UNBOUNDED_CURLS: readonly (readonly [string, string])[] = [
  ['no bound', 'curl -fsSL "$url"'],
  ['a zero -m', 'curl -m 0 "$url"'],
  ['a zero --max-time', 'curl --max-time=0 "$url"'],
  ['a connect bound only', 'curl --connect-timeout 5 "$url"'],
  ['a bound that is not a number', 'curl -m "$limit" "$url"'],
  ['a bound later set to zero', 'curl -m 5 --max-time 0 "$url"'],
  ['a wrapper passing its arguments', 'fetch() { curl -s "$@"; }'],
  ['a ceiling its caller can lift', 'fetch() { curl -s --max-time 5 "$@"; }'],
  ['a ceiling before $*', 'fetch() { curl -m 5 $*; }'],
  ['a ceiling before a forwarded array', 'curl -m 5 "${args[@]}"'],
  ['a call in a command substitution', 'body="$(curl "$url")"'],
  ['a continued call', 'curl \\\n  -fsSL "$url"'],
  ['a bound only in an inline comment', 'curl "$url" # TODO add --max-time 5'],
  ['a bound lent by a later call', 'body="$(curl "$a") $(curl -m 5 "$b")"'],
  ['a bound lent by a background call', 'curl "$a" & curl -m 5 "$b"'],
  ['a bound after its substitution closes', 'echo $(curl "$url") --max-time 5'],
  ['a bound after its backticks close', 'echo `curl "$url"` -m 5'],
  ['a bound only inside a double-quoted header', 'curl -H "X-Note: -m 5 s" "$url"'],
  ['a bound only inside single-quoted data', 'curl -d \'x -m 5 s\' "$url"'],
  ['a call after a quoted substitution', 'when="$(date)"; curl "$url"'],
  ['a call after a single-quoted backslash', 'printf \'\\\' ; curl "$url"'],
  ['an empty quoted bound', 'curl -m "" "$url"'],
  ['a call in a single-quoted bash -c program', 'bash -c \'curl "$url"\''],
  ['a call in a double-quoted sh -ec program', 'sh -ec "curl $url"'],
  ['a call in an eval string', 'eval \'curl "$url"\''],
  ['a call in a program nested in a program', 'bash -c "sh -c \'curl x\'"'],
  ['a bound only in a comment inside a program', 'bash -c \'curl "$url" # -m 5\''],
  ['a bound lent by a background command', 'curl "$url" & echo --max-time 5'],
  ['a bound lent across an unspaced &', 'curl "$url"&echo -m 5'],
  ['a bound only inside a substituted argument', 'curl $(opts --max-time 5 x) "$url"'],
  ['a bound only inside a backtick argument', 'curl `opts -m 5 x` "$url"'],
  ['a bound only inside an arithmetic argument', 'curl "$url" $((t -m 5 + 1))'],
  ['a bound only inside a parameter default', 'curl ${opts:- -m 5 x} "$url"'],
  ['a bound only in a curl run for a header', 'curl -H "$(curl -m 5 tok)" "$url"'],
  ['an unbounded curl run for the header of a bounded call', 'curl -H "$(curl tok)" -m 5 "$url"'],
  ['a ceiling before a substitution passing arguments on', 'curl -m 5 $(printf "%s " "$@")'],
  ['a bound only inside a substitution the line leaves open', 'curl "$url" $(opts -m 5\n  x)'],
  ['a bound only two substitutions deep', 'body="$(curl $(opts -m 5 x) "$url")"'],
  [
    'a bound only inside a substitution after a case pattern',
    'case "$x" in a) curl $(opts -m 5 x) "$url" ;; esac',
  ],
  ['a call in a backtick inside a parameter default', 'x=${y:-`curl "$url"`}'],
  ['a call in a substitution inside a parameter default', 'x=${y:-$(curl "$url")}'],
  ['a bound only in a quoted parameter default', 'curl "${o:-"-m 5"}" "$url"'],
  ['a bound only after a nested expansion in a default', 'curl ${a:-${b} -m 5 } "$url"'],
  ['a bound only after a double-quoted } in a default', 'curl ${u:-"}" -m 5 } "$url"'],
  ['a bound only after a single-quoted } in a default', 'curl ${u:-\'}\' -m 5 } "$url"'],
  ['a bound only after a code } in a default', 'curl ${a:-$( { :; } ) -m 5 } "$url"'],
  ['a call after a single-quoted ${', 'echo \'${\'; curl "$url"'],
];

/** Code the oracle must accept. */
const BOUNDED_CURLS: readonly (readonly [string, string])[] = [
  ['-m N', 'curl -sS -m 5 "$url"'],
  ['-mN', 'curl -sS -m5 "$url"'],
  ['--max-time=N', 'curl -sS --max-time=30 "$url"'],
  ['--max-time N with retries', 'curl -sS --retry 3 --max-time 60 "$url"'],
  ['a ceiling after the forwarded arguments', 'fetch() { curl -s "$@" --max-time 5; }'],
  ['an apt-get install', 'RUN apt-get install -y --no-install-recommends curl'],
  ['an apk add', 'RUN apk add --no-cache curl'],
  ['a comment after a bounded call', 'curl -m 5 "$url" # fetch it'],
  ['a user agent naming curl', 'curl -A "curl/8" -m 5 "$url"'],
  ['a substituted output path', 'curl -o $(mktemp) -m 5 "$url"'],
  ['an arithmetic retry count', 'curl --retry $((n + 1)) -m 5 "$url"'],
  ['a URL fragment and an array length', 'curl --retry ${#urls[@]} -m 5 http://x/#a'],
  ['curl named inside a quoted header', 'curl -m 5 -H "X-Client: my curl client" "$url"'],
  ['a backtick substitution as an argument', 'curl `get_url` -m 5'],
  ['a quoted semicolon', 'curl -H "Accept: a; b" -m 5 "$url"'],
  ['a quoted pipe and &&', 'curl -d \'a | b && c\' -m 5 "$url"'],
  ['a bounded call in a quoted substitution', 'body="$(curl -m 5 "$url")"'],
  ['a double-quoted bound', 'curl --max-time "5" "$url"'],
  ['a single-quoted -m', 'curl -m \'5\' "$url"'],
  ['a bounded call in a bash -c program', 'bash -lc \'curl -m 5 "$url"\''],
  ['curl named only in quoted text of a program', 'sh -c \'echo "use curl"\''],
  ['escaped quotes in a double-quoted program', 'bash -c "curl -H \\"a; b\\" -m 5 x"'],
  ['stderr joined before the bound', 'curl "$url" 2>&1 -m 5'],
  ['both streams redirected before the bound', 'curl "$url" &>log -m 5'],
  ['descriptor dups before the bound', 'curl "$url" >&2 <&3 -m 5'],
  ['a bounded call sent to the background', 'curl -m 5 "$url" &'],
  ['an arithmetic &', 'curl "$url" $((flags & 1)) -m 5'],
  ['an arithmetic | and &&', 'curl "$url" $((a | b && c)) -m 5'],
  ['a command list in a substituted argument', 'curl $(cat a && cat b) -m 5'],
  ['a pipeline in a quoted substitution', 'curl "$(printf x | tr x y)" -m 5'],
  ['an & in a parameter expansion', 'curl "${u//&/%26}" -m 5'],
  ['a ; in a parameter expansion', 'curl "${u//;/%3B}" -m 5'],
  ['a bounded curl run for the header of a bounded call', 'curl -H "$(curl -m 5 tok)" -m 5 "$url"'],
  ['a ( in a parameter expansion', 'curl "${u//(/%28}" -m 5'],
  ['an unquoted ( in a parameter expansion', 'curl ${u//(/%28} -m 5'],
  ['a ) in a parameter expansion in a substitution', 'body=$(curl "${u//)/%29}" -m 5)'],
  ['a quoted ; in a substitution in a parameter default', 'x=${y:-$(curl "a;b" -m 5)}'],
  ['a bounded call in a backtick in a parameter default', 'x=${y:-`curl -m 5 "$url"`}'],
  ['a pattern ( ) around a substitution', 'curl "${u//(a$(echo b)c)/x}" -m 5'],
  ['a quoted substitution in a quoted default', 'curl "${u:-"$(date)"}" -m 5'],
  ['a workflow expression in a header', 'curl -H "x: ${{ secrets.T }}" -m 5 "$url"'],
  ['a bare { in a parameter default', 'curl ${x:-{a} -m 5 "$url"'],
];

/** A bounded call placed next to each control, so a flag names the control. */
const BOUNDED_CALL = 'curl -fsSL -m 5 "$url"';

describe('Curl time bound', () => {
  it('CTB-1: every curl call the repo runs sets a positive --max-time', () => {
    const offenders = PRODUCTION.flatMap(offendersIn);
    expect(offenders).toEqual([]);
  });

  it('CTB-2: the scan reads a workflow, a Dockerfile and a shell script', () => {
    const callers = filesCallingCurl(PRODUCTION);
    const missing = KNOWN_CALLERS.filter(path => !callers.includes(path));
    expect(missing).toEqual([]);
  });

  it.each(UNBOUNDED_CURLS)('CTB-3: flags %s', (_name, snippet) => {
    const code = logicalLines(`${BOUNDED_CALL}\n${snippet}`);
    const unbounded = unboundedCalls(code, BOUNDS);
    expect(unbounded).toHaveLength(1);
  });

  it.each(BOUNDED_CURLS)('CTB-4: accepts %s', (_name, snippet) => {
    const code = logicalLines(`${BOUNDED_CALL}\n${snippet}`);
    const unbounded = unboundedCalls(code, BOUNDS);
    expect(unbounded).toEqual([]);
  });

  it('CTB-5: every skipped test harness that names curl replaces it with a stub', () => {
    const harnesses = filesCallingCurl(HARNESSES);
    const unstubbed = harnesses.filter(path => {
      const text = readRepoFile(path);
      return !CURL_STUBS.some(stub => stub.test(text));
    });
    expect(harnesses.length).toBeGreaterThan(0);
    expect(unstubbed).toEqual([]);
  });
});
