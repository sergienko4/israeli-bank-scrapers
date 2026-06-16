---
name: code-simplify
description: SIMPLIFY phase. Use after review to reduce a change to its clearest form — remove dead code, collapse needless abstraction, prefer clarity over cleverness — without changing behavior. Clarity over cleverness.
---

# /code-simplify — Simplify the code (SIMPLIFY)

**Principle:** Clarity over cleverness.

Make the change as simple as it can be **without changing behavior**. This is a
behavior-preserving pass — keep tests green throughout.

## Do

1. Remove dead code, redundant branches, and speculative abstraction.
2. Replace if/else chains with config maps (OCP); extract duplicated patterns
   into shared helpers/factories.
3. Prefer the smallest function that does one thing — re-check the ≤10-line cap.
4. Do **not** mix this with behavior changes; keep it a separate, reviewable
   diff. Re-run `npm test` to prove behavior is unchanged.

## Defer to (canonical, do not restate)

- `code-simplification-guidlines.md`
- In-repo: [`CLEAN_CODE.md`](../../../CLEAN_CODE.md); the `improve` command.

## Exit gate → SHIP

Behavior identical (tests green), diff smaller/clearer. Then run `ship`.
