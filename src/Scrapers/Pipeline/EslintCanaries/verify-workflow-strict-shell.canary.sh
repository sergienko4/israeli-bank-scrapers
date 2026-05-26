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

# Parse the YAML with Node's `yaml` package (dev-dep) so we check the
# REAL nesting `defaults.run.shell`, not three independent regex
# matches that a malformed file with stray `shell:` lines could spoof.
# Falls back to exit 1 if the package can't load — keeps the canary
# fail-loud on every other class of error.
if node --input-type=module -e "
  import yaml from 'yaml';
  import { readFileSync } from 'node:fs';
  const doc = yaml.parse(readFileSync('${FILE}', 'utf8'));
  const shell = doc?.defaults?.run?.shell ?? '';
  const tokens = String(shell);
  // Require bash + the bundled strict-mode flag pattern that
  // `bash -euo pipefail` produces. Matching the literal '-euo' is
  // safer than checking '-e' / '-u' independently — '-u' is NOT a
  // substring of '-euo' (the 'u' is preceded by 'e', not '-'), which
  // was a real bug in the first version of this canary.
  const ok = /\\bbash\\b/.test(tokens)
    && /-euo\\b/.test(tokens)
    && tokens.includes('pipefail');
  process.exit(ok ? 0 : 1);
" >/dev/null 2>&1; then
  exit 0
fi
exit 1
