/**
 * Flow-init carry barrel — re-exports the public surface from the
 * co-located sibling siblings:
 *   - `.build` — `buildInitialCarry` entrypoint (default + named).
 *
 * Internal helpers (seed/derived/parts/bootstrap/types) stay
 * sibling-private; tests and runtime consumers import the entrypoint
 * via this barrel.
 */

export { buildInitialCarry, buildInitialCarry as default } from './FlowInitCarry.build.js';
