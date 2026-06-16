---
name: build
description: BUILD phase. Use when implementing a planned task — write one thin vertical slice at a time (implement, verify, commit), honoring the project's ≤10-line functions, ≤150-line files, OCP-via-maps, no-any, and zero-CSS-selector rules. One slice at a time.
---

# /build — Build incrementally (BUILD)

**Principle:** One slice at a time.

Implement the current task as a thin vertical slice: implement → verify locally
→ commit. Never mix formatting-only changes with behavior changes.

## Do

1. Keep functions **≤10 lines**, files within cap, complexity ≤10, params ≤3 —
   extract helpers and use config maps (OCP) instead of if/else chains.
2. No `any`, no unused vars, explicit return types on helpers and
   `.map/.filter/.some` callbacks.
3. **Interaction code:** find elements by visible text only — never `$eval`,
   `querySelector`, or hardcoded CSS selectors in click/fill/navigate/wait.
4. Run `npm run build` after the slice; keep the import-cycle gate green
   (`npm run lint:cycles`) — never add a cycle.

## Defer to (canonical, do not restate)

- In-repo: [`CLEAN_CODE.md`](../../../CLEAN_CODE.md) (the caps),
  [`CLAUDE.md`](../../../CLAUDE.md) (architecture, zero-CSS-selector rule).
- `C:\tmp\guidelines\coding-principle-guidlines.md`,
  `design-patterns-guidlines.md`, `comments-in-code-guidlines.md`,
  `j-doc-guidlines.md`.

## Exit gate → VERIFY

Slice builds clean, caps hold, no new cycle. Then run `test`.
