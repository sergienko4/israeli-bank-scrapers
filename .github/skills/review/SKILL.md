---
name: review
description: REVIEW phase. Use before merge to review a change across correctness, readability, architecture, security, and performance — categorize findings as Critical/Important/Suggestion. Pairs with the @code-reviewer persona, rubber-duck, and CodeRabbit. Improve code health.
---

# /review — Review before merge (REVIEW)

**Principle:** Improve code health — leave it better than you found it.

Evaluate the change across five axes and categorize every finding. Read the
tests and the spec first; they reveal intent.

## Five axes

1. **Correctness** — does it match the spec? edge cases, error paths, races.
2. **Readability** — clear names, shallow control flow, project conventions.
3. **Architecture** — patterns honored, module boundaries, dependency
   direction, no new cycle, right abstraction level.
4. **Security** — input validated at boundaries, no secrets in code/logs, no
   new vulnerable deps, PII handled per policy.
5. **Performance** — no N+1, no unbounded loops/fetches, async where needed.

Categorize: **Critical** (block) / **Important** (fix before merge) /
**Suggestion**. Never approve with a Critical open.

## Use our reviewers

- `@code-reviewer` persona ([`.github/agents/`](../../agents/)), the `improve`
  and `pr-review` commands, the rubber-duck agent, and CodeRabbit on the PR.
- The A3.5 pre-PR exit gate is the human-readable record of this phase.

## Defer to (canonical, do not restate)

- `pr-guidlines.md`, `coding-principle-guidlines.md`
- In-repo: [`CLEAN_CODE.md`](../../../CLEAN_CODE.md), [`CLAUDE.md`](../../../CLAUDE.md).

## Exit gate → SIMPLIFY / SHIP

`npm run lint` clean, no Critical/Important open. Then run `code-simplify` if
the change can be clearer, else `ship`.
