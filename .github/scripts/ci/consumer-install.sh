#!/usr/bin/env bash
#
# Install the published package the way a consumer does, then run it.
#
# WHY THIS EXISTS
# ---------------
# CI tests the repository; it never tests the package. Every job runs from the
# working tree, where devDependencies are installed and `CI=true` is set by the
# runner. Issue #552 is invisible under both of those conditions:
#
#   * `pino-pretty` is a devDependency that the shipped code resolves at
#     runtime. In CI it is always on disk, so it always resolves.
#   * The transport that reaches for it is selected only when `CI` is unset
#     AND `NODE_ENV` is not `production` — which is the ordinary state of a
#     consumer's application, and a state no CI job can ever be in.
#
# So the failure is unreachable in CI by construction, not by accident. This
# gate is the one place that leaves the working tree behind: it packs the real
# tarball, installs it into a scratch project with `--omit=dev`, and runs it
# with `CI` and `NODE_ENV` explicitly unset.
#
# The scratch project installs the production graph our lockfile pins, root
# `overrides` included, through `npm ci` - not a fresh resolve. OpenSSF
# Scorecard classifies every `npm install` as an unpinned download, exact
# version or not, and accepts `npm ci` (code-scanning alert #131). Both
# defects this gate exists for survive that: devDependencies are still
# absent, and the scrape still has to settle. What no pinned install can show
# is the version drift a consumer's fresh resolve would pick up.
#
# WHAT IT ASSERTS
# ---------------
#   1. The scrape SETTLES. A silent `exit 0` is the worst outcome a library can
#      produce - the consumer cannot even tell that anything went wrong - so it
#      is treated as a failure, not as "no output".
#   2. The failure is not the logger's. Dying because a devDependency cannot be
#      resolved happens before any network call, which makes it look like the
#      bank is unreachable.
#   3. The pino/thread-stream graph the consumer resolved still matches the
#      private `kImpl` layout that worker retirement (RetireWorkerEnd.ts) writes
#      into: pino inside the range the packed manifest declares, the supported
#      thread-stream major, the same shared-state offsets, and a live stream that
#      still carries the `kImpl` record. Offline and deterministic; no bank.
#
# NO BANK IS CONTACTED. The smoke replaces fetch with a synthetic 503 response,
# making the native Leumi run hermetic and independent of the bank's status.
#
# Usage:
#   CONSUMER_NODE=/absolute/path/to/floor-node consumer-install.sh
# Run with the build-tool Node on PATH; only smoke programs use CONSUMER_NODE.
#
# Exit codes:
#   0  the package settles with an actionable outcome in every environment
#   1  it abandoned the scrape, or died resolving its own logger

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${REPO_ROOT}"

CONSUMER_NODE="${CONSUMER_NODE:-node}"
RUNTIME_FLOOR="$(node -p "require('./package.json').engines.node.match(/^>=\s*(\d+\.\d+\.\d+)$/)?.[1] ?? ''")"
if [ -z "$RUNTIME_FLOOR" ] || [ "$("$CONSUMER_NODE" -p 'process.versions.node')" != "$RUNTIME_FLOOR" ]; then
  echo "consumer-install: CONSUMER_NODE must run the engines.node floor ($RUNTIME_FLOOR)" >&2
  exit 1
fi
echo "==> Consumer runtime: $("$CONSUMER_NODE" --version)"

# Proof that the scrape produced an outcome at all. Its absence is the
# silent-abandonment failure, which prints nothing by definition.
SETTLED_MARKER="SETTLED"

# The failure mode that must never reach a consumer: the shipped code
# resolving a devDependency at runtime.
TRANSPORT_FAILURE="unable to determine transport target"

# The controlled outcome is Leumi's first native request receiving a synthetic
# HTTP 503. Require both the request marker and the resulting step failure.
#
# Asserting the expected outcome POSITIVELY is the point. Accepting anything
# that merely settled would let an unrelated regression inside the package -
# a TypeError on import, a reworked error message - report success, because
# it too would print a settled line.
EXPECTED_REQUEST="OFFLINE_REQUEST"
EXPECTED_OUTCOME="prime HTTP 503"

# A scrape reports failure by returning a result. `SETTLED throw` means an
# exception escaped to the consumer, which is a defect in its own right.
EXPECTED_KIND="SETTLED result"

# No bank may be contacted, so a scrape that reports success means the harness
# has stopped being hermetic and the gate is no longer proving anything.
EXPECTED_VERDICT='"success":false'

WORK_DIR=""

# Remove the throwaway project even when an assertion aborts the script, so a
# failed run leaves the working tree exactly as it found it. The tarball lives
# inside it, so there is nothing to clean up in the repo itself.
cleanup() {
  if [ -n "${WORK_DIR}" ] && [ -d "${WORK_DIR}" ]; then
    rm -rf "${WORK_DIR}"
  fi
}
trap cleanup EXIT

PKG_NAME="$(node -p "require('${REPO_ROOT}/package.json').name")"

WORK_DIR="$(mktemp -d)"

# Packing into the scratch directory rather than the repo root keeps the run
# from leaving a tarball behind, and leaves exactly one `.tgz` to glob for -
# so the version never has to be spelled out, and a stale tarball from an
# earlier build cannot be picked up by mistake.
echo "==> Packing ${PKG_NAME}"
npm pack --pack-destination "${WORK_DIR}" >/dev/null
set -- "${WORK_DIR}"/*.tgz
TARBALL="$1"

echo "==> Installing the locked production graph (npm ci --omit=dev)"
mkdir -p "${WORK_DIR}/app"
cd "${WORK_DIR}/app"
cp "${REPO_ROOT}/package.json" "${REPO_ROOT}/package-lock.json" "${REPO_ROOT}/.npmrc" .
# The package declares `exports`, so a project carrying its name would resolve
# the import to itself instead of to node_modules.
npm pkg set name=consumer-smoke
npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null 2>&1

# Unpack the real tarball where installing it would have placed it.
PKG_DIR="node_modules/${PKG_NAME}"
mkdir -p "${PKG_DIR}"
tar -xzf "${TARBALL}" -C "${PKG_DIR}" --strip-components=1
cp "${REPO_ROOT}/.github/scripts/ci/consumer-smoke.cjs" ./smoke.cjs
cp "${REPO_ROOT}/.github/scripts/ci/consumer-smoke.mjs" ./smoke.mjs

# Worker retirement writes ThreadStream's private `kImpl` shared-state protocol
# (fixed word offsets), which is not a public contract. This probe asks the graph
# the packed package actually resolved whether that layout is still there; it
# reads the installed packages only and never touches the network. Its constants
# mirror RetireWorkerEnd.ts, and ConsumerRuntime.test.ts fails when they drift.
cat > ./layout-probe.cjs <<'LAYOUT_PROBE'
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const WRITE_INDEX = 4;
const READ_INDEX = 8;
const IMPL_SYMBOL = 'kImpl';
// Raising this is a deliberate decision: re-verify the layout against the new major first.
const SUPPORTED_THREAD_STREAM_MAJOR = 4;

function check(isOk, message) {
  if (!isOk) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function satisfiesCaret(version, range) {
  const want = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
  check(want !== null, `unsupported pino range "${range}"; teach this probe the new form`);
  const have = version.split('-')[0].split('.').map(Number);
  const [major, minor, patch] = want.slice(1).map(Number);
  return have[0] === major && (have[1] > minor || (have[1] === minor && have[2] >= patch));
}

function findImpl(stream) {
  const symbols = Object.getOwnPropertySymbols(stream);
  const symbol = symbols.find(candidate => candidate.description === IMPL_SYMBOL);
  check(symbol !== undefined, `thread-stream carries no ${IMPL_SYMBOL} state record`);
  return stream[symbol];
}

function checkImplShape(impl) {
  const hasState = impl.state instanceof Int32Array && impl.state.length > READ_INDEX;
  check(hasState, `${IMPL_SYMBOL}.state is not an Int32Array covering READ_INDEX`);
  const hasFlags = typeof impl.flushing === 'boolean' && typeof impl.ending === 'boolean';
  check(hasFlags && typeof impl.buf === 'string', `${IMPL_SYMBOL} lacks flushing/ending/buf`);
}

function resolveGraph(packageDir) {
  const manifest = path.resolve(packageDir, 'package.json');
  const fromPackage = createRequire(manifest);
  const range = readJson(manifest).dependencies.pino;
  const pinoManifest = fromPackage.resolve('pino/package.json');
  const threadManifest = createRequire(pinoManifest).resolve('thread-stream/package.json');
  const pinoVersion = readJson(pinoManifest).version;
  const threadVersion = readJson(threadManifest).version;
  return { fromPackage, range, pinoVersion, threadManifest, threadVersion };
}

function checkVersions(graph) {
  const { range, pinoVersion, threadVersion } = graph;
  check(satisfiesCaret(pinoVersion, range), `pino ${pinoVersion} is outside the packed range ${range}`);
  const major = Number(threadVersion.split('.')[0]);
  const message = `thread-stream ${threadVersion} is outside the supported major ${SUPPORTED_THREAD_STREAM_MAJOR}`;
  check(major === SUPPORTED_THREAD_STREAM_MAJOR, message);
}

function checkIndexes(graph) {
  const indexesFile = path.join(path.dirname(graph.threadManifest), 'lib', 'indexes.js');
  const indexes = require(indexesFile);
  const isSame = indexes.WRITE_INDEX === WRITE_INDEX && indexes.READ_INDEX === READ_INDEX;
  check(isSame, `thread-stream offsets ${indexes.WRITE_INDEX}/${indexes.READ_INDEX} moved from ${WRITE_INDEX}/${READ_INDEX}`);
}

function checkLiveStream(graph) {
  const pino = graph.fromPackage('pino');
  const stream = pino.transport({ target: 'pino/file', options: { destination: os.devNull } });
  stream.on('error', error => {
    console.log(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
  try {
    checkImplShape(findImpl(stream));
  } finally {
    stream.end();
  }
}

try {
  const graph = resolveGraph(process.argv[2] || process.cwd());
  checkVersions(graph);
  checkIndexes(graph);
  checkLiveStream(graph);
  const supported = `range ${graph.range}, supported thread-stream major ${SUPPORTED_THREAD_STREAM_MAJOR}`;
  console.log(`ok - pino ${graph.pinoVersion}, thread-stream ${graph.threadVersion} (${supported}); ${IMPL_SYMBOL} layout intact`);
} catch (error) {
  console.log(`FAIL: ${error.message}`);
  process.exitCode = 1;
}
LAYOUT_PROBE

# `pino-pretty` must be absent, or the gate proves nothing: the transport
# would resolve and the defect would stay hidden exactly as it does in CI.
if [ -d "node_modules/pino-pretty" ]; then
  echo "FAIL: pino-pretty is present in a production install - gate is vacuous"
  exit 1
fi

FAILED=0

# Diagnostics go to stdout, not stderr, so each verdict stays next to the
# `==>` header it belongs to. The two streams are buffered independently once
# CI captures them, which detaches a failure from the environment that caused
# it. The exit code, not the stream, is the machine-readable verdict.
#
# Assert the settled outcome is the expected controlled environment failure
# rather than merely *an* outcome.
#
# $1 - captured smoke output
#
# Returns 0 when every expectation is present, 1 otherwise (marking the run
# failed, so the caller can bail out without repeating the bookkeeping).
assert_expected_outcome() {
  local output="$1"
  local expectation
  for expectation in "${EXPECTED_KIND}" "${EXPECTED_VERDICT}" "${EXPECTED_REQUEST}" "${EXPECTED_OUTCOME}"; do
    case "${output}" in
      *"${expectation}"*)
        ;;
      *)
        echo "    FAIL: settled, but not with the outcome this gate expects."
        echo "          missing: ${expectation}"
        echo "          ${output}"
        FAILED=1
        return 1
        ;;
    esac
  done
  return 0
}

# Run the consumer program under one environment and assert on the outcome.
#
# $1 - consumer entrypoint program
# $2 - human-readable environment label; remaining arguments go to `env`
run_environment() {
  local program="$1" label="$2"
  shift 2
  echo "==> Consumer environment: ${label} (${program})"

  # The exit status is part of the verdict, so it is captured rather than
  # discarded: the smoke program exits non-zero when an exception escapes to
  # the consumer. `|| status=$?` keeps that from aborting the run under
  # `set -e` while still recording what happened.
  local output
  local status=0
  output="$(env "$@" "$CONSUMER_NODE" "./${program}" 2>&1)" || status=$?

  case "${output}" in
    *"${SETTLED_MARKER}"*)
      ;;
    *)
      echo "    FAIL: the scrape never settled - no result, no error."
      echo "          A consumer sees the process exit silently."
      FAILED=1
      return 0
      ;;
  esac

  case "${output}" in
    *"${TRANSPORT_FAILURE}"*)
      echo "    FAIL: died resolving its own logger transport."
      echo "          ${output}"
      FAILED=1
      return 0
      ;;
  esac

  if [ "${status}" -ne 0 ]; then
    echo "    FAIL: an exception escaped to the consumer (exit ${status})."
    echo "          A scrape must report failure by returning a result."
    echo "          ${output}"
    FAILED=1
    return 0
  fi

  assert_expected_outcome "${output}" || return 0

  echo "    ok - settled with the expected environment failure"
  echo "    ${output}"
  return 0
}

# Assert the dependency graph the packed package resolved still matches the
# private `kImpl` layout worker retirement writes into.
#
# $1 - directory of the installed package whose manifest and resolution to use
#
# Returns 0 always; a mismatch marks the run failed, like the other assertions.
assert_dependency_layout() {
  local package_dir="$1"
  echo "==> Worker-retirement dependency layout (as resolved from the packed package)"
  local output
  local status=0
  output="$("$CONSUMER_NODE" ./layout-probe.cjs "${package_dir}" 2>&1)" || status=$?
  if [ "${status}" -ne 0 ]; then
    echo "    FAIL: the installed pino/thread-stream no longer match the private layout"
    echo "          worker retirement writes into (RetireWorkerEnd.ts)."
    echo "          ${output}"
    FAILED=1
    return 0
  fi
  echo "    ${output}"
  return 0
}

assert_dependency_layout "${PKG_DIR}"

# The default state of a consumer's application: none of these are set.
# This is the environment no CI job can reproduce. PRETTY_LOGS is unset
# explicitly so a developer who exports it cannot silently run this gate
# down a different transport branch than CI does.
for program in smoke.cjs smoke.mjs; do
  run_environment "$program" "default (CI and NODE_ENV unset)" -u CI -u NODE_ENV -u PRETTY_LOGS
  run_environment "$program" "NODE_ENV=production" -u CI -u PRETTY_LOGS NODE_ENV=production
done

if [ "${FAILED}" -ne 0 ]; then
  echo "" >&2
  echo "consumer-install: the published package does not work for consumers." >&2
  exit 1
fi

echo "consumer-install: package behaves for consumers in every environment ✓"
