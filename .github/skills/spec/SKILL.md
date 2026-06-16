---
name: spec
description: DEFINE phase. Use when starting a new feature, bug fix, or significant change to write a short spec/PRD before any code — objectives, scope, affected modules, acceptance criteria, and boundaries. Spec before code.
---

# /spec — Define what to build (DEFINE)

**Principle:** Spec before code.

Produce a short spec **before** touching code. For this repo, a spec is a file
under [`tasks/`](../../../tasks/) (use the `new-task` command to scaffold it).

## Do

1. State the objective in one sentence and the acceptance criteria as a
   checklist.
2. List the affected modules and whether the public surface (`src/index.ts`)
   changes. If it does — flag it; that needs explicit approval.
3. Capture boundaries: what is **out** of scope, new dependencies needed
   (ask first), and any irreversible/risky steps.
4. If the ask is underspecified, interview one question at a time until ~95%
   confident — do **not** guess.

## Defer to (canonical, do not restate)

- `plan-guidlines.md`,
  `doubt-driven-development-guidlines.md`,
  `context-engineering-guidlines.md`
- In-repo: [`CLAUDE.md`](../../../CLAUDE.md) for architecture constraints.

## Exit gate → PLAN

Spec file exists with objective + acceptance criteria + boundaries, and the
public-surface impact is known. Then run `plan`.
