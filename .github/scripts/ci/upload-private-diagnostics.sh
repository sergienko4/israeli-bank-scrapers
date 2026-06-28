#!/usr/bin/env bash
#
# Upload the full forensic run directory as a single archive to the
# access-controlled OCI bucket.
#
# Best-effort diagnostics sink. Runs on E2E failure always, and on success
# too during FORENSIC_TRACE diagnostic runs, so green control traces (e.g.
# Isracard) land beside a red Amex for side-by-side diffing. The run
# directory only exists
# when FORENSIC_TRACE=true gated the pipeline into writing per-run artefacts
# (pipeline.log, network/*.json, screenshots/*.png) under /tmp/runs; otherwise
# this is a clean no-op. Upload uses a write-only pre-authenticated request
# (AnyObjectWrite = create/overwrite only; no read, list, or delete; bucket
# NoPublicAccess; short TTL). This is the SOLE diagnostics sink: the full
# run dir (pipeline.log, network/*.json, screenshots) is uploaded only
# here -- nothing goes to GitHub artifacts (PII-safe).
#
# Skips cleanly (exit 0) when the PAR secret is absent (forks / external PRs)
# or when no run directory was produced, so it can never fail the job.
#
# Env:
#   OCI_DIAG_PAR_URL  write-only PAR base URL (secret; absent on forks -> skip)
#   DIAG_BANK         object-key prefix for this matrix bank (default: unknown)
#   RUN_TAG           run/attempt tag for the object key (default: local)
set -euo pipefail

bank="${DIAG_BANK:-unknown}"
run_tag="${RUN_TAG:-local}"

if [ -z "${OCI_DIAG_PAR_URL:-}" ]; then
  echo "OCI_DIAG_PAR_URL not configured -- skipping private upload."
  exit 0
fi

root=/tmp/runs/pipeline
[ -d "$root" ] || { echo "no run dir -- nothing to upload."; exit 0; }

# Bundle the whole run dir into ONE archive so the trace is fetched in a
# single download instead of 100+ per-file objects. zip is preinstalled
# on ubuntu-latest; fall back to tar.gz if it is ever unavailable.
if ! work="$(mktemp -d)"; then
  echo "WARN: temp workdir creation failed -- skipping upload."
  exit 0
fi
trap 'rm -rf "$work"' EXIT

# Archive creation must never fail the job (best-effort sink): on any
# error, log a WARN and exit 0. The EXIT trap still cleans the workdir.
if command -v zip >/dev/null 2>&1; then
  archive="${work}/forensic-${bank}-${run_tag}.zip"
  ( cd "$root" && zip -qr "$archive" . ) || { echo "WARN: archive build failed -- skipping upload."; exit 0; }
else
  archive="${work}/forensic-${bank}-${run_tag}.tar.gz"
  tar -czf "$archive" -C "$root" . || { echo "WARN: archive build failed -- skipping upload."; exit 0; }
fi

obj="${bank}/${run_tag}/$(basename "$archive")"
if curl -sS --fail-with-body --connect-timeout 10 --max-time 300 --retry 3 --retry-delay 2 -T "$archive" "${OCI_DIAG_PAR_URL}${obj}"; then
  echo "uploaded ${obj} ($(wc -c <"$archive" | tr -d ' ') bytes)"
else
  echo "WARN: upload failed for ${obj}"
fi
echo "private diagnostics upload complete."
