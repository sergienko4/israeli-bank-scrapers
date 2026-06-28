/**
 * Gated A/B lever for login submit strategy (D3 diagnostic).
 *
 * Default behaviour is 'enter-click' — byte-identical to pre-D3.
 * Set PIPELINE_LOGIN_SUBMIT_MODE=form or =all in CI to test the
 * AngularJS form.requestSubmit() path without altering the default.
 *
 * Only the classic fill path (ActionsFill.ts runSubmitPhase) supports
 * requestSubmit. The discovery path (ActionsDiscovery.ts) does not
 * expose the form element and keeps default enter+click behaviour.
 */

/** Every submit strategy the lever supports. */
export type SubmitMode = 'enter-click' | 'form' | 'all';

/** Environment variable that activates non-default submit strategies. */
export const SUBMIT_MODE_ENV_VAR = 'PIPELINE_LOGIN_SUBMIT_MODE';

/**
 * Map of accepted PIPELINE_LOGIN_SUBMIT_MODE values.
 * OCP: add a new mode here without touching readSubmitMode().
 */
const SUBMIT_MODE_MAP: Record<string, SubmitMode> = {
  'enter-click': 'enter-click',
  form: 'form',
  all: 'all',
};

/**
 * Read the active submit strategy from the environment.
 * Any value not in SUBMIT_MODE_MAP (including unset) returns 'enter-click'.
 * @returns Active SubmitMode — defaults to 'enter-click'.
 */
export function readSubmitMode(): SubmitMode {
  const raw = process.env[SUBMIT_MODE_ENV_VAR] ?? '';
  return SUBMIT_MODE_MAP[raw] ?? 'enter-click';
}
