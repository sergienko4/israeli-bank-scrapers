# On-demand PR review agent

> **Who this is for:** maintainers who want a second review of a pull request
> without waiting for an automatic tool. The agent runs only when asked. It
> reviews the diff, the changed files and the repository rules; it never
> executes pull-request code.

The agent is an OpenCode session with a read-only reviewer profile and six
review skills. Its output is one severity-ranked `COMMENT` review with a
summary and, where a finding maps to an added line, an inline comment.

## Request a review

The workflow has two entry points:

- **PR comment** — a maintainer comments `/review` on the pull request.
  `/review model=deepseek-v4-pro` selects the alternate model.
- **Manual dispatch** — run **On-demand PR review** from the Actions tab with a
  PR number and an optional model.

Automatic `pull_request` reviews are deliberately not enabled. The comment
path is gated to `OWNER`, `MEMBER` and `COLLABORATOR`, re-checks the actor's
repository permission through the API, and accepts same-repository PRs only.

## Models

Only DeepSeek models on OpenCode Go are allowed. The workflow discovers the
current catalog from `https://opencode.ai/inference/go/v1/models` and keeps
every model whose ID starts with `deepseek`. It reads each model's supported
reasoning efforts from the catalog, so a new DeepSeek release works without
editing the repository:

```text
/review model=deepseek-v5-flash
/review model=deepseek-v5-flash#max
/review model=deepseek-v4-pro#high
```

With no selector, the workflow picks the newest DeepSeek release and its
preferred effort (`high`, then `max`, then `low`). A pinned fallback list in
[`.github/review-agent/config.json`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/.github/review-agent/config.json)
keeps reviews working if the catalog is unreachable. The agent file does not
pin a model.

## Setup

Add these repository settings once:

| Kind     | Name                      | Value                                                                   |
| -------- | ------------------------- | ----------------------------------------------------------------------- |
| Secret   | `OPENCODE_API_KEY`        | OpenCode Go API key; no GitHub App setup                                |
| Secret   | `REVIEW_GUIDELINES_TOKEN` | Fine-grained PAT, Contents: Read-only on `sergienko4/review-guidelines` |
| Variable | `REVIEW_GUIDELINES_REPO`  | `sergienko4/review-guidelines`                                          |

`GITHUB_TOKEN` is built in; the workflow grants it `contents: read` and
`pull-requests: write` and posts as `github-actions[bot]`. No service account or
OpenCode GitHub App is needed.

## What the agent reviews

| Skill                    | Focus                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| `pr-review-context`      | Intent, scope, change type and affected flow                       |
| `pr-review-code`         | Correctness, errors, tests, types and standards                    |
| `pr-review-architecture` | Boundaries, contracts, compatibility and rollout                   |
| `pr-review-security`     | STRIDE threat model, secrets, auth, input, PII and CI supply chain |
| `pr-review-quality`      | Observability, performance, readability and comments               |
| `pr-review-orchestrator` | Order, severity rubric, caps and the JSON contract                 |

The private `sergienko4/review-guidelines` repository supplies the guideline
text and a `manifest.json` that maps each file to a skill. The workflow checks
it out read-only beside the base branch. The PR working tree is never checked
out, and the agent gets no shell, edit, web or subagent tools. Credential-shaped
files (`.env*`, private keys, certificates, `.npmrc`, `.netrc`) are excluded
from the changed-file copies and diff hunks before the reviewer reads them.
Changed files are stored under neutral names mapped by `metadata.files[].dataFile`,
so a PR-supplied `AGENTS.md` cannot become reviewer instructions.

## Output

The agent returns one JSON object:

```json
{
  "summary": "Markdown summary",
  "guidelines_read": ["review-guidelines/pr-review-guidelines.md"],
  "findings": [
    {
      "severity": "important",
      "path": "src/example.ts",
      "line": 42,
      "title": "Keep the retry inside the timeout",
      "body": "The retry can outlive the request deadline. Reuse the deadline.",
      "rule": "pr-review-guidelines §11"
    }
  ]
}
```

The posting step keeps the highest-signal findings inline, up to 10, and moves
the rest into the summary. The review event is always `COMMENT`; the agent
never approves and never requests changes. Every summary states that no tests,
builds or pull-request code were executed.

## Security model

| Risk                                | Control                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| Prompt injection in PR text or code | PR content is data; no shell/edit/web tools; schema-validated output         |
| Secret exfiltration                 | No PR code execution; keys stay in workflow env; logs masked                 |
| PR edits the reviewer or workflow   | Base branch is the working tree; PR content only under `.review/pr/`         |
| Comment-trigger abuse               | PR-only, exact `/review`, association allow-list, API permission re-check    |
| Cost or runaway run                 | Per-PR concurrency, 20-minute timeout, diff and comment caps, 30 model steps |
| Token scope                         | `contents: read`, `pull-requests: write`; no `id-token`                      |
| Guidelines repo compromise          | Fine-grained read-only token for that one repository                         |

Fork PRs are out of scope for the first version. A fork trigger would need a
separate no-secret workflow and its own threat model.

## Local run

The reviewer agent can be exercised locally from a checkout with the DeepSeek
model configured in OpenCode:

```bash
opencode run --agent pr-reviewer \
  --model opencode-go/deepseek-v4.1-flash#high \
  "Review .review/pr and return the review JSON."
```

Local runs are read-only and use the same skills. They are useful for
troubleshooting the prompt; they are not a substitute for the workflow's
permission checks.

## Troubleshooting

| Symptom                       | Check                                                                  |
| ----------------------------- | ---------------------------------------------------------------------- |
| No review comment             | The actor must be a maintainer and the PR must be same-repo and open   |
| `model not allowed`           | Use a model and variant from `.github/review-agent/config.json`        |
| `guidelines manifest missing` | The private checkout or `REVIEW_GUIDELINES_TOKEN` is misconfigured     |
| Review is summary-only        | The model response was invalid, or findings did not map to added lines |
| Review did not run            | Automatic reviews are off by design; use `/review` or dispatch         |

## Disable

Remove or disable the workflow entry point. The agent and skills are inert
without a caller, and the configuration file has no runtime effect on its own.
