#!/usr/bin/env bash
#
# Fail the E2E-smoke matrix cell when it executed no test at all.
#
# WHY: `jest --testNamePattern=<pattern>` matching nothing is not an error to
# jest. It loads the suite, reports every test as "skipped", and exits 0. A
# matrix entry in `pr.yml` that drifts out of sync with a `SMOKE_BANKS`
# display name (rename, typo, added bank) therefore produces a GREEN cell
# that tested nothing — the worst possible outcome for a gate that is meant
# to prove invalid credentials are rejected.
#
# Reproduced against a real suite:
#   --testNamePattern='ZZZ_NEVER_MATCHES'
#   -> numPassedTests=0, numFailedTests=0, numPendingTests=18, success=true
#
# A test that FAILS still counts as executed: this script asserts the cell
# ran its bank, not that the bank passed. Bank pass/fail is owned by the
# jest step itself.
#
# Counts are read with `node` rather than `jq` so the script depends only on
# the runtime the smoke step already requires, and stays runnable locally.
#
# Env:
#   BANK                matrix bank display name (message only; default: unknown)
#   SMOKE_RESULT_FILE   jest --outputFile path (default: smoke-result.json)
set -euo pipefail

bank="${BANK:-unknown}"
result_file="${SMOKE_RESULT_FILE:-smoke-result.json}"

if [ ! -f "$result_file" ]; then
  echo "::error::[$bank] jest produced no $result_file - the smoke step did not run to completion."
  exit 1
fi

if ! counts="$(node -e '
const fs = require("node:fs");
const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const count = (value) => (typeof value === "number" ? value : 0);
const fields = ["numPassedTests", "numFailedTests", "numPendingTests"];
process.stdout.write(fields.map((field) => count(report[field])).join(" "));
' "$result_file" 2>/dev/null)"; then
  echo "::error::[$bank] could not read test counts from $result_file (malformed JSON?)."
  exit 1
fi

read -r passed failed pending <<<"$counts"
executed=$((passed + failed))

if [ "$executed" -lt 1 ]; then
  echo "::error::[$bank] E2E-smoke matrix drift: 0 tests executed (${pending} skipped)."
  echo "The --testNamePattern for '$bank' matched no test."
  echo "Every 'bank:' entry in the e2e-smoke matrix must equal a displayName"
  echo "in src/Tests/E2eSmoke/SmokeConfig.ts exactly."
  exit 1
fi

echo "[$bank] executed ${executed} smoke test(s) (${passed} passed, ${failed} failed)."
