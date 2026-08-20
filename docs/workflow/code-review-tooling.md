# Code-review tooling

> **Who this is for:** maintainers responding to CodeRabbit (CR) and SonarCloud (SQ) findings during a PR review cycle. This page documents the canonical query APIs and the OSS-plan rate-limit posture so a fresh contributor (or a fresh agent session) can audit findings deterministically instead of guessing.

This repo runs two automated review tools on every PR:

| Tool | What it produces | Where it lives |
|---|---|---|
| **CodeRabbit** | Walkthrough comment + inline review threads + summary review | `.coderabbit.yaml` (root) — see [config rationale](#coderabbit-config-rationale) below |
| **SonarCloud Scan** | New-issue list bound to the PR | `sonar-project.properties` + the `SonarCloud Scan` CI job |

SonarCloud surfaces findings on PR-open and on every push. CodeRabbit does not:
below 10 stars it reviews only when asked — see [Automatic review is gated on
star count](#automatic-review-is-gated-on-star-count). The C8 step of the [post-PR checklist](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/.github/PULL_REQUEST_TEMPLATE.md) requires the maintainer to **pull every open finding, verify against the current working tree, and either fix or document a disposition before requesting re-review**.

The query commands below are the canonical way to do that pull — they do not depend on the GitHub web UI rendering finished by the time you check.

---

## CodeRabbit — query protocol

CodeRabbit posts to three distinct surfaces. Pull each one separately.

### 1. Review state (CHANGES_REQUESTED / APPROVED / COMMENTED)

```bash
gh api repos/{owner}/{repo}/pulls/{N}/reviews \
  --jq '.[] | select(.user.login | contains("coderabbit")) | {id, state, submitted_at, body_preview: (.body[0:200])}'
```

The most recent `submitted_at` wins. `state` controls whether the PR is blocked by the request-changes workflow.

### 2. Inline file/line comments

```bash
gh api repos/{owner}/{repo}/pulls/{N}/comments \
  --jq '.[] | select(.user.login | contains("coderabbit")) | {id, path, line, body: (.body[0:400])}'
```

These are the actionable findings. Each comment maps to one file + one line in the PR diff.

### 3. Walkthrough / summary comment

```bash
gh api repos/{owner}/{repo}/issues/{N}/comments \
  --jq '.[] | select(.user.login | contains("coderabbit")) | {id, created_at, body: .body[0:1000]}'
```

The first ~49 KB block is the walkthrough. It contains the high-level summary, suggested labels, sequence diagrams, and the "estimated review effort" — useful context, but **not** the actionable findings list (use call #2 for that).

### 4. Trigger a fresh review manually

When `auto_pause_after_reviewed_commits` has paused auto-review (see [config rationale](#coderabbit-config-rationale)), trigger a one-off review by posting `@coderabbitai review` (incremental) or `@coderabbitai full review` (from scratch) as a PR comment.

---

## SonarCloud — query protocol

SonarCloud's web project is public, so its REST search API is reachable without authentication.

### List all new issues introduced by a PR

```bash
curl -sS "https://sonarcloud.io/api/issues/search?\
componentKeys=sergienko4_israeli-bank-scrapers&\
pullRequest={N}&\
issueStatuses=OPEN,CONFIRMED&\
sinceLeakPeriod=true&\
ps=100" | \
  jq '.issues[] | {key, severity, type, component, line, message, rule}'
```

| Parameter | Meaning |
|---|---|
| `componentKeys` | Project key from `sonar.projectKey` in `sonar-project.properties` |
| `pullRequest` | PR number |
| `issueStatuses=OPEN,CONFIRMED` | Skip already-resolved findings |
| `sinceLeakPeriod=true` | New issues introduced by THIS PR only (drops pre-existing) |
| `ps=100` | Page size (max 500) |

### Get gate status for the PR

```bash
curl -sS "https://sonarcloud.io/api/qualitygates/project_status?\
projectKey=sergienko4_israeli-bank-scrapers&\
pullRequest={N}" | jq '.projectStatus.status'
```

Returns `OK`, `ERROR`, or `NONE`. The `SonarCloud Scan` CI job is GREEN iff `status == "OK"`.

---

## CodeRabbit config rationale

This repository is a public MIT-licensed fork. CodeRabbit auto-classifies it as **Open Source plan** — see [`docs.coderabbit.ai/management/plans`](https://docs.coderabbit.ai/management/plans):

| Plan | PR reviews / hour / developer | Files / review | Chat / hour |
|---|---|---|---|
| OSS (this repo) | **1-10** (varies with community size) | **100-300** (same) | 25 |

### Automatic review is gated on star count

Measured 2026-08-20: this repository has **5 stars**, below the threshold. CodeRabbit's status comment on every PR says, verbatim:

> This repository does not receive automatic reviews because it has fewer than 10 stars.

That threshold is [documented policy](https://docs.coderabbit.ai/management/plans): *"For public repositories with less than 10 stars, CodeRabbit requires reviews to be triggered manually."* It is keyed on the GitHub star count alone — **no repository change satisfies it.** Not config, not code quality, not a paid plan: the status comment already reports `Plan: Pro Plus`, which is what the OSS tier grants. Stars are a community metric, so the only honest levers are the ones that earn them (discoverability: topics, README, npm keywords, the docs site).

Three consequences follow, and each has bitten us:

| Consequence | Detail |
|---|---|
| **A push alone never produces a CodeRabbit review** | Someone must post `@coderabbitai review` (or tick *Trigger review*). A PR left alone gets a status comment and a walkthrough, never a verdict. SonarCloud is unaffected and still runs per push. |
| **The `auto_review` block in `.coderabbit.yaml` is inert** | `auto_pause_after_reviewed_commits: 3` cannot pause what never started. The keys stay because they go live at 10 stars. |
| **The 150-file PR cap may be optimistic** | OSS files/review is **100-300** by popularity. At 5 stars, assume the low end: a 150-file PR risks ~50 files silently unreviewed. Prefer splitting well before 150. |

Because of the first row, the general "a normal push auto-reviews itself, so do nothing" guidance does **not** hold in this repository. Following it here means never receiving a review at all.

PR #281 exhausted the per-hour cap when 6 incremental commits were pushed within ~90 min. CodeRabbit's default `auto_pause_after_reviewed_commits` of **5** was too high to throttle that burst.

The current `.coderabbit.yaml` is tuned for the OSS plan with the following deliberate choices:

| Setting | Value | Why |
|---|---|---|
| `enable_free_tier` | `true` (explicit) | OSS plan declaration |
| `language` | `en-US` | matches schema enum default |
| `reviews.profile` | `assertive` | high signal on refactor PRs |
| `reviews.request_changes_workflow` | `true` | auto-approves once all CR threads resolve |
| `reviews.auto_review.auto_pause_after_reviewed_commits` | **`3`** | pauses after 3 reviewed pushes — dormant below 10 stars (see above), live once auto-review switches on |
| `reviews.auto_review.ignore_title_keywords` | `["WIP", "DO NOT MERGE", "[skip review]", "[skip-ci]"]` | lightweight quota saver |
| `reviews.poem`, `in_progress_fortune` | `false` | token-spend with no review value |
| `tools.ruff/phpstan/swiftlint/hadolint` | `false` | not used in this TypeScript-only repo |
| `tools.biome/markdownlint/shellcheck/languagetool/github-checks/ast-grep` | `true` | actually used here |
| `finishing_touches.unit_tests` | `false` | we author tests with strict canon-10 shape; auto-gen would clash |
| `path_filters` | excludes `lib/`, `dist/`, `coverage/`, `docs/api/` (TypeDoc gen), `*.snap`, `.understand-anything/`, `.copilot/`, `tasks/`, `.husky/`, `*.min.*` | stop CR from re-analyzing generated / local-only paths |
| `path_instructions[EslintCanaries/**]` | tells CR canaries are deliberate rule-breakers | prevents CR from flagging intentional lint violations as bugs |

**Workflow implication (today, below 10 stars):** nothing reviews itself. Post `@coderabbitai review` once per batch of fixes, and still batch those fixes into **1-3 commits per cycle** so each trigger covers meaningful ground and stays inside the 1-10/hour cap. At 10+ stars the `auto_review` keys above take over and the same batching keeps a push burst from exhausting the cap — which is exactly what PR #281 did.

---

## Disposition trace

Every CR + SQ finding gets a row in the maintainer's session ledger (`hardening_todos` + `cr_findings` SQLite tables) with verdict (`real`, `false-positive`, `pre-existing`) and action (`fix-applied`, `deferred-to-phase-X`, `wont-fix-rationale`). The PR body's `## Guideline compliance` section links each cluster to the disposition for auditors.

See `C:\tmp\guidelines\post-pr-checklist.md` (C8 row) for the full canonical protocol.
