#!/usr/bin/env bash
# Renders the post-merge pipeline result as a Mermaid DAG plus a status
# table into the GitHub Actions step summary.
#
# Why a script and not an inline `run:` block: this is the one artifact a
# maintainer reads when a merge goes wrong, so it needs to be runnable (and
# therefore verifiable) outside CI. Every input arrives through the
# environment so it can be exercised locally:
#
#   R_CHANGES=success R_CODEQL=failure R_SONAR=success \
#   R_WFSEC=success R_DOCS=skipped R_RELEASE=success RELEASED=true \
#   VERSION=8.6.7 SHA=abc1234 \
#   GITHUB_STEP_SUMMARY=/dev/stdout bash .github/scripts/ci/pipeline-summary.sh
set -euo pipefail

: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY must be set}"
SHA="${SHA:-unknown}"

# Mermaid has no "skipped" concept, so results are mapped onto three node
# classes. Anything not success/skipped is treated as a problem, which keeps
# `cancelled` and `failure` visible instead of silently rendering as neutral.
node_class() {
  case "$1" in
    success) echo "ok" ;;
    skipped) echo "skip" ;;
    *) echo "bad" ;;
  esac
}

icon() {
  case "$1" in
    success) echo "✅" ;;
    skipped) echo "⏭️" ;;
    failure) echo "❌" ;;
    cancelled) echo "🚫" ;;
    *) echo "❔" ;;
  esac
}

# On an ordinary merge release-please only opens or refreshes the Release PR,
# so a green release stage that published nothing is the common case — say so
# explicitly rather than leaving "success" to be misread as "shipped".
release_detail() {
  if [ "${R_RELEASE:-}" != "success" ]; then
    echo ""
  elif [ "${RELEASED:-}" = "true" ] && [ -n "${VERSION:-}" ]; then
    echo " — published v${VERSION}"
  elif [ "${RELEASED:-}" = "true" ]; then
    echo " — published"
  else
    echo " — no new version (Release PR updated)"
  fi
}

# A merge is only clean if nothing failed. `skipped` is a legitimate outcome
# (docs are not always republished), so it does not count against the run.
overall="clean"
for r in "${R_CHANGES:-}" "${R_CODEQL:-}" "${R_SONAR:-}" "${R_WFSEC:-}" \
  "${R_DOCS:-}" "${R_RELEASE:-}"; do
  case "$r" in
    success | skipped | '') ;;
    *) overall="problems" ;;
  esac
done

{
  if [ "$overall" = "clean" ]; then
    echo "## ✅ Main pipeline: clean"
  else
    echo "## ❌ Main pipeline: needs attention"
  fi
  echo ""
  echo "Commit \`${SHA:0:7}\`"
  echo ""
  echo '```mermaid'
  echo "flowchart LR"
  echo "  changes[\"Detect changes\"]:::$(node_class "${R_CHANGES:-}")"
  echo "  codeql[\"CodeQL\"]:::$(node_class "${R_CODEQL:-}")"
  echo "  sonar[\"SonarCloud\"]:::$(node_class "${R_SONAR:-}")"
  echo "  wfsec[\"Workflow security\"]:::$(node_class "${R_WFSEC:-}")"
  echo "  docs[\"Docs\"]:::$(node_class "${R_DOCS:-}")"
  echo "  release[\"Release\"]:::$(node_class "${R_RELEASE:-}")"
  echo "  summary[\"Summary\"]:::ok"
  echo "  changes --> docs"
  echo "  codeql --> summary"
  echo "  sonar --> summary"
  echo "  wfsec --> summary"
  echo "  docs --> summary"
  echo "  release --> summary"
  echo "  classDef ok fill:#1a7f37,stroke:#1a7f37,color:#fff;"
  echo "  classDef bad fill:#cf222e,stroke:#cf222e,color:#fff;"
  echo "  classDef skip fill:#6e7781,stroke:#6e7781,color:#fff;"
  echo '```'
  echo ""
  echo "| Stage | Result |"
  echo "| --- | --- |"
  echo "| Detect changes | $(icon "${R_CHANGES:-}") ${R_CHANGES:-unknown} |"
  echo "| CodeQL | $(icon "${R_CODEQL:-}") ${R_CODEQL:-unknown} |"
  echo "| SonarCloud | $(icon "${R_SONAR:-}") ${R_SONAR:-unknown} |"
  echo "| Workflow security | $(icon "${R_WFSEC:-}") ${R_WFSEC:-unknown} |"
  echo "| Docs | $(icon "${R_DOCS:-}") ${R_DOCS:-unknown} |"
  echo "| Release | $(icon "${R_RELEASE:-}") ${R_RELEASE:-unknown}$(release_detail) |"
  echo ""
  echo "Everything a merge does is in this run — there is no second workflow to"
  echo "open. \`Release\` cuts the release; npm publish happens inside it, on the"
  echo "merge of the Release PR."
} >> "$GITHUB_STEP_SUMMARY"

# The summary must never be the reason a merge looks green, so mirror the
# verdict into the job's exit status.
if [ "$overall" != "clean" ]; then
  echo "::error::Main pipeline reported failures - see the run summary."
  exit 1
fi
