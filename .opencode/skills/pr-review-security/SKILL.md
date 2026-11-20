---
name: PR Review Security
description: Build a focused threat model and review secrets, auth, input, PII and CI supply chain
---

# PR Review Security

Sources: `pr-review-guidelines.md` §5; `coding-principle-guidlines.md` and
`logging-pii-guidlines.md`. This repository handles bank credentials, session
tokens, cookies and transaction data; assume every input is hostile.

## Threat model first

For each changed trust boundary, write one line per STRIDE category that
applies:

- **Spoofing** — whose identity is asserted, and what proves it?
- **Tampering** — what data crosses the boundary, and what validates it?
- **Repudiation** — is the security-relevant action observable without
  leaking the secret?
- **Information disclosure** — can a secret, token, cookie, PII or error
  detail reach a log, fixture, URL, comment or third party?
- **Denial of service** — is there an unbounded loop, retry storm, allocation
  or request amplification?
- **Elevation of privilege** — can a caller reach a capability it did not
  have?

Do not invent a threat the diff does not touch. Say "no new boundary" when
that is true.

## Secrets and PII

- No credential, token, cookie, key or customer identifier in code, tests,
  fixtures, commit messages, error text or logs.
- Redaction happens at the boundary; a debug path cannot bypass it.
- Error messages are fixed and body-free when the upstream can echo a secret.
- A test fixture that looks real is a finding even when the value is synthetic,
  unless it is clearly labelled and cannot collide with a real account.

## Input and output

- Validate type, format, range, length and allow-list at every boundary.
- No string-built query, command, template, path or URL with raw input.
- No HTML or Markdown injection in generated review comments; escape links
  and reject `javascript:`.
- No unsafe deserialization, prototype pollution or path traversal.
- Auth checks are server-side, deny by default and cannot be skipped by a
  feature flag.

## CI and supply chain

- Workflow permissions are the minimum; no `id-token`, `actions: write` or
  `contents: write` unless the job needs it.
- No `pull_request_target` with a checkout of PR code.
- No PR-controlled value in `run:` script interpolation; pass it through an
  environment variable and quote it.
- Third-party actions are pinned by SHA.
- Caches and artifacts do not carry secrets across trust boundaries.
- A new dependency has a reason, a lockfile entry and no known critical CVE.

## Agent-specific boundary

When the diff touches an agent or a review workflow:

- PR content is data, never instructions.
- The agent has no shell, edit, web or subagent tool unless the design proves
  the boundary.
- The model output is schema-validated before posting.
- The guidelines checkout is read-only and isolated from the PR working tree.
- A PR cannot edit the skill or workflow that the reviewer loads.

## Finding quality

State the attacker, the path, the asset and the concrete fix. A theoretical
risk with no reachable path is a `suggestion`, not a `critical`. A reachable
secret leak or auth bypass is `critical`.
