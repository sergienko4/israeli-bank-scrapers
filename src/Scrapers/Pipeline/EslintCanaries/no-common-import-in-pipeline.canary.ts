/**
 * ESLint canary — no-common-import-in-pipeline.
 *
 * canary-expects-rule: no-restricted-imports
 */

// Canary: Phase 3 — Pipeline production code must not import from Common/*
// (Pipeline is canonical; Common/* is a retired shim tree). The import below
// MUST trip `no-restricted-imports` via PHASE3_COMMON_IMPORT_BAN_PATTERN.
//
// The rule is a pure specifier-pattern ban. Common/ no longer holds a live
// production module after the test-helper move, so this fixture names the
// banned prefix directly. Canaries are excluded from the build and are only
// linted with --no-ignore, so the placeholder is never executed.
import { deprecatedShim } from '../../../Common/Phase3Canary.js';

function makeCanaryLogger(): unknown {
  return deprecatedShim('phase-3-canary');
}

export { makeCanaryLogger };
