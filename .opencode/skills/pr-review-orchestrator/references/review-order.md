# Review order

The order is deliberate: a correctness finding without context is noise, and
a security finding without the data flow is guesswork.

## 1. Context — `pr-review-context`

- What problem does the PR claim to solve?
- Is the change type clear: feature, fix, refactor, test, docs, CI or
  dependency?
- Which component, bank pipeline, phase or public surface is affected?
- What is the expected behaviour before and after?
- Does the diff match the stated scope?
- Which tests, docs and migrations should move with it?
- Is there an unstated dependency on another service, workflow or team?

Stop here if the diff is empty, the PR body is missing and the commit messages
do not explain the change, or a changed file could not be fetched.

## 2. Code — `pr-review-code`

- Does the happy path do what the context says?
- Are empty, null, boundary, duplicate, partial and failure cases handled?
- Are errors typed and returned, not thrown for expected outcomes?
- Are timeouts, retries, cancellation and cleanup defined?
- Do tests prove the behaviour at the lowest useful level?
- Are negative, retry, timeout and cross-bank cases present when relevant?
- Does the change follow the repository's caps, naming and import rules?
- Can a branch, duplication or temporary variable be removed without changing
  behaviour?

## 3. Architecture — `pr-review-architecture`

- Is the change in the right layer and module?
- Does it preserve the dependency direction and avoid a new cycle?
- Is the variation expressed as configuration, a strategy or a map rather
  than a new branch?
- Are contracts and public types stable, or is there a migration?
- Is compatibility with existing data, tokens, consumers and workflows
  preserved, with a rollback?
- Is the change observable enough to operate?

## 4. Security — `pr-review-security`

- What are the trust boundaries and untrusted inputs?
- Can input reach a query, command, template, path, log or URL unsafely?
- Are authn, authz and session handling correct?
- Are secrets, tokens, cookies and PII kept out of code, logs, fixtures and
  errors?
- Does the CI/workflow change preserve least privilege and safe checkout
  rules?
- Does the diff add a dependency or action without provenance?
- Does the change create a prompt-injection path for an agent?

## 5. Quality — `pr-review-quality`

- Are structured events, correlation IDs and error context sufficient?
- Is there an N+1, unbounded loop, large allocation or avoidable latency?
- Are names, control flow and file size within the repository's caps?
- Do comments explain WHY and stay correct?
- Do JSDoc and docs match the changed public behaviour?
- If UI files change, are labels, focus, contrast and keyboard paths covered?
- Is each comment worth the reviewer's attention?

## Combine

One issue is one finding. Merge duplicate observations, keep the highest
severity, and cite the strongest rule. A finding that cannot name an added
diff line belongs in the summary.
