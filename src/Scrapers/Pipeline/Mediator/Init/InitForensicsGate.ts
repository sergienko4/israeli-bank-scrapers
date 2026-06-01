/**
 * INIT-phase forensics opt-in gate.
 *
 * <p>When {@link INIT_FORENSICS_ENV_VAR} is OFF (default), every
 * extra-observability hook in `Mediator/Init/**` becomes a no-op —
 * no `page.on()` listeners attach, no `page.evaluate()` runs, no
 * extra log line emits. The launch path is byte-identical to the
 * PR-#288 baseline (the last known-passing state for the Hapoalim
 * Imperva-hCaptcha auto-solve flow shipped in PR #282).
 *
 * <p>When the env-var is ON, the full INIT envelope is captured:
 * {@link EnvSnapshot.logEnvSnapshot}, the L7 console + landing
 * observers in {@link "./PageObservers.js"}, and the frame-tree
 * snapshot.
 *
 * <p>Why this exists. Each extra `page.on()` subscription adds a
 * Marionette-wire activity dimension that Camoufox's C++ stealth
 * cannot mask, and each pre-navigation `page.evaluate()` adds a
 * synthetic JS execution that is atypical for human browsing.
 * Empirically (PR #289 → Hapoalim E2E Real B failure on
 * `164fe73b`) Imperva's risk model picked up that drift and started
 * rejecting our checkbox-hCaptcha tokens, escalating the challenge
 * from invisible-checkbox to image-grid (≥5 retry loop → test
 * timeout). The gate restores the WAF-passing default while
 * keeping the triage tooling reachable for opt-in debug runs (set
 * `PIPELINE_INIT_FORENSICS=1` in the workflow_dispatch env to
 * unlock the full envelope).
 */

/** Env-var name that flips the gate. */
export const INIT_FORENSICS_ENV_VAR = 'PIPELINE_INIT_FORENSICS';

/** String values of {@link INIT_FORENSICS_ENV_VAR} that enable forensics. */
const ENABLED_VALUES: readonly string[] = Object.freeze(['1', 'true']);

/**
 * Branded gate state — Rule #15 forbids primitive returns at module
 * boundaries, so callers receive a frozen wrapper they pattern-match
 * via {@link IInitForensicsGateState.enabled} instead of a bare
 * boolean.
 */
export interface IInitForensicsGateState {
  readonly enabled: boolean;
}

/** Singleton enabled-state — reused so identity comparison works. */
const GATE_ENABLED: IInitForensicsGateState = Object.freeze({ enabled: true });
/** Singleton disabled-state — the default and the WAF-safe value. */
const GATE_DISABLED: IInitForensicsGateState = Object.freeze({ enabled: false });

/**
 * Read the current state of the forensics gate. Reads
 * {@link INIT_FORENSICS_ENV_VAR} every call so a test (or
 * `workflow_dispatch` run) can toggle the gate mid-process.
 *
 * @returns {@link GATE_ENABLED} only when the env-var is `'1'` or
 *   `'true'`. Any other value (including unset, empty, `'0'`, or
 *   `'false'`) returns {@link GATE_DISABLED} so the safest default
 *   is OFF.
 */
export function readInitForensicsGate(): IInitForensicsGateState {
  const value = process.env[INIT_FORENSICS_ENV_VAR];
  if (value === undefined) return GATE_DISABLED;
  if (ENABLED_VALUES.includes(value)) return GATE_ENABLED;
  return GATE_DISABLED;
}
