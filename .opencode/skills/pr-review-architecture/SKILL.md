---
name: PR Review Architecture
description: Review design boundaries, contracts, compatibility and rollout for a change
---

# PR Review Architecture

Sources: `pr-review-guidelines.md` §3, 11–12; `general-rules-guidlines.md`,
`coding-principle-guidlines.md`, `design-patterns-guidlines.md` and
`CLEAN_CODE.md`.

## Boundaries

- Is the change in the layer that owns the behaviour?
- Does it keep the dependency direction: Banks → Core → Phases → Mediator →
  Strategy → Registry → Logging → Types?
- Does it add a forbidden edge, a cycle or a bank-specific branch in a neutral
  layer?
- Is the shared abstraction owned by the neutral layer, with the bank value
  injected as configuration?
- Does the pipeline remain immutable, deterministic and injectable?

## Contracts

- Are public types, configuration keys, token formats and API shapes changed?
- If yes, is there a compatible path for existing callers, data and stored
  tokens, or an explicit breaking-change decision?
- Are error types and failure semantics stable?
- Is the change extensible without editing the core: a map, strategy, policy
  or config entry?
- Are all dependencies resolved at construction time?

## Operability

- Is there a rollout, feature flag, migration or rollback for a risky change?
- Can an operator tell whether the new path is active and healthy?
- Does the change preserve testability and mockability?
- Does it add a second source of truth for the same decision?
- Does the documentation describe the new behaviour and its limits?

## Finding quality

Prefer a structural finding that explains the future cost over a naming
preference. A new abstraction is not automatically better: ask what variation
it absorbs and whether the repository already has that seam. A compatibility
break is `important` unless it can lose data or bypass security, in which case
it is `critical`.
