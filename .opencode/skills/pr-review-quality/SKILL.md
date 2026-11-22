---
name: PR Review Quality
description: Review observability, performance, readability, comments and accessibility
---

# PR Review Quality

Sources: `pr-review-guidelines.md` §7–8, 13–20;
`performance-optimization-guidlines.md`, `logging-pii-guidlines.md`,
`comments-in-code-guidlines.md`, `j-doc-guidlines.md` and
`accessibility-guidlines.md` when UI files change.

## Observability

- Does a new failure path emit a structured event with a stable name and the
  fields an operator needs, without PII or secrets?
- Are correlation IDs and run context preserved?
- Can an operator tell the new failure modes apart from logs alone?
- Does the change add a silent fallback that hides a real failure?
- Is the log level correct: error for a broken invariant, warn for a
  recoverable edge, info for a state change, debug for diagnosis?

## Performance

- No N+1 request per item when one call can carry the batch the provider
  supports.
- No unbounded loop, unbounded retry, unbounded buffer or large synchronous
  parse.
- Timeouts and backoff exist for every remote call.
- A cache has a key, an expiry and an invalidation story.
- The change does not add a third-party request to the hot path without a
  measured need.

## Readability

- Names describe the domain and the decision, not the syntax.
- Control flow is shallow; the happy path is visible.
- Functions, files, complexity and parameters respect the repository's caps
  when documented.
- Duplication is removed only when the shared shape is stable; premature
  abstraction is also a finding.
- The diff does not reformat unrelated code.

## Comments and docs

- A comment explains WHY, a constraint, a bug or a non-obvious invariant.
- It does not restate the next line or drift from the code.
- Public behaviour, configuration and errors are documented where the repo
  requires it.
- JSDoc matches the signature, parameters, return and failure.
- A deleted behaviour has its docs deleted or updated in the same change.

## Accessibility

Only when UI files change: labels, roles, focus order, keyboard paths,
contrast, error announcement and touch target size. If the diff has no UI
surface, skip this section silently.

## Finding quality

Every finding costs the author time. Keep a finding when it prevents a bug,
a security issue, a compatibility break or a costly rewrite. Drop purely
stylistic points; do not report them anywhere.
