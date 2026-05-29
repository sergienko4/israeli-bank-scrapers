/**
 * PiiRedactor Facade — unified entry point composing every
 * per-category strategy.
 *
 * Phase 6 commit 1: this module is intentionally an empty shell. The
 * strategy registry and the unified `redact()` / `classify()` entry
 * points are populated in commit 5 (AuthCredentials + ErrorLog + Facade
 * composition). Commit 6 then collapses `../PiiRedactor.ts` into a
 * re-export shim that points at this Facade.
 *
 * Spec: pipeline-decoupling-master-2026-05-28 / phase-6 / spec.txt §3.
 */

export {};
