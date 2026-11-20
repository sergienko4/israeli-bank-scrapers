---
name: PR Review Code
description: Review correctness, failure handling, tests and standards in changed code
---

# PR Review Code

Sources: `pr-review-guidelines.md` §4, 6, 9–11; `test-guidlines.md`,
`test-cases-guidlines.md`, `mocking-test-guidlines.md`,
`test-integration-testing.md`, `testing-organization-guidlines.md` and
`code-simplification-guidlines.md`.

## Correctness

- Walk the happy path from input to observable result.
- Check empty, null, boundary, duplicate, partial and concurrent cases.
- Check every failure path: typed error, message, cleanup and caller effect.
- Check retries, timeouts, cancellation and resource release where I/O exists.
- Check arithmetic, date, currency, encoding and ordering assumptions.
- Check that the change does not rely on a test-only path in production.

## Tests

- A behaviour change has a test at the lowest level that captures it.
- The test fails for the old behaviour, not just passes for the new one.
- Negative, retry, timeout and cross-bank cases exist when the flow has them.
- Mocks are typed, shared and faithful to the contract; they do not duplicate
  production logic.
- Fixtures are synthetic and contain no customer data.
- The test does not assert an implementation detail that the change is free
  to alter.

## Standards

- Types are explicit at boundaries; no `any`, no suppressed error, no unused
  export.
- Constants come from configuration, not inline literals.
- Names describe the domain, not the implementation.
- The change follows the repository's function, file, complexity and parameter
  caps in `CLEAN_CODE.md`.
- No dead code, debug output, commented-out block or temporary file.
- Imports and exports follow the layer and cycle rules.

## Simplification

- Replace a branch chain with a map, strategy or configuration entry when the
  variation is data.
- Remove a temporary variable, duplicated call or wrapper that adds no meaning.
- Keep a comment only when it explains WHY, a non-obvious constraint or a bug.
- Do not ask for a rewrite that is larger than the problem.

## Finding quality

Name the failing input or path, the consequence, and the smallest fix. Do not
report a formatter preference; the formatter owns it. Do not report a missing
test unless the changed behaviour is real and the test would catch a plausible
regression.
