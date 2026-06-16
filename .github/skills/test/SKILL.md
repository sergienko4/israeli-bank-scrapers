---
name: test
description: VERIFY phase. Use when proving a change works — write/extend tests (unit > integration > e2e, lowest level that captures the behavior), use typed mocks and shared factories, and run the full validation suite. Tests are proof.
---

# /test — Prove it works (VERIFY)

**Principle:** Tests are proof.

A change is not done until a test proves it. For bugs, write the failing test
first, then fix.

## Do

1. Pick the **lowest** level that captures the behavior (unit > integration >
   e2e). Keep the pyramid weighted to unit tests.
2. Use typed mocks and shared factories (`makeMockLocator`, etc.) — never
   `as any` in mocks, never duplicate production logic in tests.
3. Run the suite — in this repo use the ESM runner:
   `node --experimental-vm-modules node_modules/jest/bin/jest.js --testPathPatterns "<regex>"`
   for targeted runs; `npm test` for the full pass.
4. Run `npm run lint:cycles` and the architecture/dead-code gates.

## Defer to (canonical, do not restate)

- `C:\tmp\guidelines\test-guidlines.md`, `test-cases-guidlines.md`,
  `mocking-test-guidlines.md`, `testing-organization-guidlines.md`,
  `test-integration-testing.md`
- In-repo command: `validate` (runs type-check + lint + test + build).

## Exit gate → REVIEW

Targeted tests pass, suite is green, gates clean. Then run `review`.
