# On-demand PR review agent

> **Who this is for:** maintainers who want a second review of a pull request
> without waiting for an automatic tool. The agent runs only when asked. It
> reviews the diff, the changed files and the repository rules; it never
> executes pull-request code.

The reviewer is an OpenCode session with a read-only reviewer profile, six
review skills and a per-repository overlay. The App submits a normal review:
`COMMENT`, `REQUEST_CHANGES` or `APPROVE`. It does not change repository
settings.

## Request a review

| Command                              | Result                                                              |
| ------------------------------------ | ------------------------------------------------------------------- |
| `/review`                            | `COMMENT` for clean/suggestions, `REQUEST_CHANGES` for blocking     |
| `/review model=deepseek-v4-pro#high` | Same, with a chosen DeepSeek model                                  |
| `/review approve`                    | Fresh full review; `APPROVE` only when the review is clean/complete |
| `/review approve model=...`          | Same, with a chosen model                                           |

A maintainer with write/admin permission can ask. The PR author may ask by
default because the App is the approving identity. In App mode, a model or API
failure posts nothing on the PR; the legacy fallback posts a failure notice so
maintainers can see why the review did not run.

## Architecture

```text
PR comment
  -> GitHub App webhook
  -> Cloudflare Worker (verify, dedupe, dispatch)
  -> private review-runner workflow (OIDC token exchange)
  -> target base checkout + PR diff fetch
  -> OpenCode reviewer
  -> COMMENT / REQUEST_CHANGES / APPROVE
  -> informational check run
```

The Worker and runner live in the private `sergienko4/review-runner` repository.
The runner never receives the App private key. The target token is scoped to one
repository and expires with the job.

The legacy `.github/workflows/pr-review-agent.yml` in this repository remains a
fallback until cutover. It uses the same scripts with `GITHUB_TOKEN` and is
same-repository only. It accepts plain `/review` and `/review model=...` from a
PR comment, or a manual **On-demand PR review** dispatch with a PR number;
`/review approve` requires the App runner. The fallback sets
`REVIEW_RECHECK_HEAD=true`, so it refuses to post when the head moved during the
model run; approvals additionally require an unchanged, non-draft PR.

## What the agent reviews

| Skill                    | Focus                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| `pr-review-context`      | Intent, scope, change type and affected flow                       |
| `pr-review-code`         | Correctness, errors, tests, types and standards                    |
| `pr-review-architecture` | Boundaries, contracts, compatibility and rollout                   |
| `pr-review-security`     | STRIDE threat model, secrets, auth, input, PII and CI supply chain |
| `pr-review-quality`      | Observability, performance, readability and comments               |
| `pr-review-orchestrator` | Order, severity rubric, output contract and stop rule              |

The private `sergienko4/review-guidelines` repository supplies the guideline
text and a `manifest.json` that maps each file to a skill. The runner checks it
out read-only. The PR working tree is never checked out, and the agent has no
shell, edit, web or subagent tools.

Credential-shaped files (`.env*`, private keys, certificates, `.npmrc`,
`.netrc`, `.git-credentials`) and content matching the supported credential
patterns are excluded from the changed-file copies, diff hunks and PR metadata
before the reviewer reads them. Changed files are stored under neutral names
mapped by `metadata.files[].dataFile`.

This is a pattern filter, not a full secret scanner. An ordinary source file
with a password assignment or an unsupported token format can still reach the
reviewer. Do not rely on this filter as the only protection for secrets.

## Approval and existing policy

The App submits `APPROVE` only after a fresh full review of the current head
with:

- no `critical` or `important` findings;
- a complete review (no truncated diff, skipped/sensitive file or file-cap hit);
- no earlier App `REQUEST_CHANGES` on the same head SHA (a human block is
  governed by the repository's own policy);
- a live head that still matches the reviewed SHA.

The existing repository ruleset and branch protection are unchanged. The App
cannot satisfy a code-owner review; a human code owner may still be required. If
GitHub does not count the App approval, it is advisory. No bypass is added.

## Setup

The full setup and runbook are in the runner repository. Maintainers with
access can read its `README.md` and `docs/runbook.md`.

Manual gates:

1. Create the `Review Agent` GitHub App and install it on selected repos.
2. Create the Cloudflare KV namespace and deploy the Worker.
3. Create the dispatch PAT and Worker secrets.
4. Add the runner secrets/variables and deploy the workflow.

The runner repo is private. GitHub Free blocks rulesets on private repos, so
`main` is unprotected until the repo is public or the account is Pro.

## Security model

| Risk                                | Control                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| Prompt injection in PR text or code | PR content is data; no shell/edit/web tools; schema-validated output          |
| Secret exfiltration                 | No PR code execution; credential files/content withheld; keys stay in secrets |
| PR edits the reviewer or workflow   | Runner and guidelines are checked out separately; PR content is data only     |
| Comment-trigger abuse               | PR-only, exact command, association allow-list, API permission re-check       |
| Webhook spoofing/replay             | HMAC, 10-minute age guard, signed comment ID dedupe                           |
| Token scope                         | Target-scoped installation token; App key only in the Worker                  |
| Cost or runaway run                 | Per-PR concurrency, 20-minute timeout, diff/comment caps, 30 model steps      |

Fork reviews are disabled in this version. The repository's `no-fork-prs.yml`
policy stays in place.

## Local run

The reviewer agent can be exercised locally from a checkout with the DeepSeek
model configured in OpenCode:

```bash
opencode run --agent pr-reviewer \
  --model opencode-go/deepseek-v4.1-flash#high \
  "Review .review/pr and return the review JSON."
```

Local runs are read-only and use the same skills. They are not a substitute for
the workflow's permission checks.

## Troubleshooting

| Symptom                       | Check                                                                  |
| ----------------------------- | ---------------------------------------------------------------------- |
| No review comment             | The App is installed; the PR is open; the actor is a maintainer        |
| `model not allowed`           | Use a model and variant from `.github/review-agent/config.json`        |
| `guidelines manifest missing` | The private checkout or `REVIEW_GUIDELINES_TOKEN` is misconfigured     |
| Review is summary-only        | The model response was invalid, or findings did not map to added lines |
| Check run is stuck            | The finish step recovers and completes the run; rerun if still stuck   |
| Review did not run            | Check the Worker delivery and the runner Actions run                   |

## Disable

1. Disable `.github/workflows/pr-review-agent.yml` in this repository. The
   legacy workflow accepts `/review` comments independently, so uninstalling
   the App or disabling the Worker does not stop reviews while it is active.
2. Uninstall the App or disable the Worker route. The runner and skills are
   inert without a caller.

The legacy workflow is the rollback path only when a maintainer explicitly
re-enables it. Do not re-enable it while the App is installed, or one `/review`
comment can produce two reviews. Re-enabling it also requires the target
repository's `OPENCODE_API_KEY` and `REVIEW_GUIDELINES_TOKEN` secrets and the
`REVIEW_GUIDELINES_REPO` variable; configuring only the runner secrets is not
enough.
