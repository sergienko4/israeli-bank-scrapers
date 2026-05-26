#!/usr/bin/env bash
# Canary — closes PR #261 review finding CR1 (.github/workflows/pr.yml).
#
# Scans the supplied YAML file for a workflow-scope `defaults.run.shell`
# block that pins `bash` with strict mode (`-e -u -o pipefail`). Without
# this, multi-line `run: |` blocks silently swallow command failures,
# undefined env vars, and pipeline failures (e.g. `cmd | tee` hiding a
# non-zero `cmd` exit behind tee's 0). Exits 0 when present, non-zero
# when absent. The harness (verify.sh) runs this against both the
# accepted fixture (must pass) and the rejected fixture (must fail).
#
# Applicable guidelines (per coding-principle-guidlines.md):
#   - "Fail closed, never open."
#   - "Defense in Depth — security must exist in multiple independent
#     layers (this rule is one of those layers for CI)."
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <workflow.yml>" >&2
  exit 2
fi

FILE="$1"
if [[ ! -f "$FILE" ]]; then
  echo "fixture not found: $FILE" >&2
  exit 2
fi

# Check the three required tokens individually so we stay portable
# across grep flavours (GNU on Linux, BSD on macOS, Git Bash on Win):
#   1. Workflow-scope `defaults:` block (must be at column 0).
#   2. A `shell:` line whose value contains `bash`.
#   3. The strict-mode flag bundle `-euo pipefail` on a `shell:` line.
# Allows future tightening (e.g. `--noprofile`) without churn.
if grep -qE '^defaults:' "$FILE" \
  && grep -qE '^\s+shell:[[:space:]]+bash' "$FILE" \
  && grep -qE '^\s+shell:[[:space:]].*-euo[[:space:]]+pipefail' "$FILE"; then
  exit 0
fi
exit 1
