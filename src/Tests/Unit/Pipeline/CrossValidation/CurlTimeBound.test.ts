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
/** A shell function or a PATH executable named `curl`, replacing the real one. */
const CURL_STUB_RE = /^\s*curl\(\)\s*\{|\/bin\/curl\b/mu;

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
      return !CURL_STUB_RE.test(text);
    });
    expect(harnesses.length).toBeGreaterThan(0);
    expect(unstubbed).toEqual([]);
  });
});
