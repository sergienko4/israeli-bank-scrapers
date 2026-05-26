#!/usr/bin/env bash
# Canary — closes PR #261 review finding CR15 (README.md phone example).
#
# Scans the supplied markdown file for any `phoneNumber: '+972...'`
# (international-plus form) inside a code-fence example. The Phone
# input contract documented in README requires the caller to pass
# digits-only international form (no leading `+`, no dashes) — the
# mediator does the per-bank wire rewrite. A `+972` in the example
# contradicts the contract and silently mis-trains readers.
#
# Exits 0 when no contradicting example is present, non-zero when
# at least one is. Harness (verify.sh) wires this to its
# accepted / rejected fixture pair.
#
# Applicable guidelines:
#   - comments-in-code-guidlines.md "Comments must remove confusion,
#     not create it" — applies to README examples by analogy.
#   - PR #261 CodeRabbit CR15 — the original violation that motivated
#     this canary.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <readme-or-markdown.md>" >&2
  exit 2
fi

FILE="$1"
if [[ ! -f "$FILE" ]]; then
  echo "fixture not found: $FILE" >&2
  exit 2
fi

# Match: `phoneNumber:` (any whitespace) followed by an opening quote
# (single or double), `+972`, and AT LEAST one trailing digit. The
# trailing-digit requirement anchors the match to a realistic code
# example, so prose mentions like "phoneNumber: '+972' is wrong"
# stay allowed.
if grep -Eq "phoneNumber:[[:space:]]*['\"]\\+972[0-9]" "$FILE"; then
  exit 1
fi
exit 0
