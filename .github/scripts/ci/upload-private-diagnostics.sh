#!/usr/bin/env bash
#
# Upload the full forensic run directory to the access-controlled OCI bucket.
#
# Best-effort, failure-only diagnostics sink. The run directory only exists
# when FORENSIC_TRACE=true gated the pipeline into writing per-run artefacts
# (pipeline.log, network/*.json, screenshots/*.png) under /tmp/runs; otherwise
# this is a clean no-op. Upload uses a write-only pre-authenticated request
# (AnyObjectWrite = create/overwrite only; no read, list, or delete; bucket
# NoPublicAccess; short TTL). Screenshots reach this private store only --
# never the public upload-artifact step.
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

find "$root" -type f -print0 | while IFS= read -r -d '' f; do
  obj="${bank}/${run_tag}/${f#"$root"/}"
  if curl -sS --fail-with-body --retry 3 --retry-delay 2 -T "$f" "${OCI_DIAG_PAR_URL}${obj}"; then
    echo "uploaded ${obj}"
  else
    echo "WARN: upload failed for ${obj}"
  fi
done
echo "private diagnostics upload complete."
