---
name: plan
description: PLAN phase. Use after a spec exists to decompose it into small, atomic, independently shippable tasks with acceptance criteria and dependency ordering. Tracked in plan.md and the GitHub Project. Small, atomic tasks.
---

# /plan — Plan how to build it (PLAN)

**Principle:** Small, atomic tasks.

Turn the spec into the smallest set of independently verifiable, atomic units —
each its own commit/PR.

## Do

1. Decompose into tasks that each pass on their own (one concern per task).
2. Order by dependency; record them in `plan.md` and the GitHub Project board.
3. For each task define: the change, the gate that proves it, and rollback.
4. Prefer one measurable win per PR over broad churn (e.g. for decoupling work,
   a task that actually drops the `lint:cycles` count beats a file-size shuffle).

## Defer to (canonical, do not restate)

- `C:\tmp\guidelines\plan-ooda-loop-guidlines.md`,
  `general-phases-view-guidlines.md`,
  `ooda-agent-invocation-contract-exmplate.md`
- In-repo workflow: [`CLAUDE.md`](../../../CLAUDE.md) §Workflow.

## Exit gate → BUILD

Tasks are atomic, ordered, and tracked, each with an acceptance gate. Then run
`build` on the first task.
