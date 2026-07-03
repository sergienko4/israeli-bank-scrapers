/**
 * BIND-API-MEDIATOR phase — provisions a browser-page ApiMediator for
 * browser hard-model banks, inserted between auth (LOGIN/OTP-*) and
 * API-DIRECT-SCRAPE. Headless banks already carry a mediator (wired by
 * PipelineContextFactory) so this phase is absent from their chain and,
 * if ever reached, is a no-op (idempotent — see {@link bindBrowserPageMediator}).
 *
 * Thin orchestration only: the bind logic lives in BindApiMediatorActions
 * so the per-file LOC ceiling holds. Reuses {@link SimplePhase} — the exec
 * is a free function, so no `class-methods-use-this` concern. Zero bank
 * coupling per Rule #11.
 */

import type { BasePhase } from '../../Types/BasePhase.js';
import type { ActionExecFn } from '../../Types/SimplePhase.js';
import { SimplePhase } from '../../Types/SimplePhase.js';
import { bindBrowserPageMediator } from './BindApiMediatorActions.js';

/**
 * Action exec — bind the browser-page mediator into the context and prime the
 * Bearer for token banks. Returns the async bind procedure directly.
 * @param _ctx - Sealed context (unused; input threads the same object).
 * @param input - Sealed action context threaded forward.
 * @returns Context carrying the primed browser-page mediator, or a failure.
 */
const BIND_EXEC: ActionExecFn = (_ctx, input) => bindBrowserPageMediator(input);

/**
 * Build the BIND-API-MEDIATOR phase instance.
 * @returns BasePhase named 'bind-api-mediator'.
 */
function createBindApiMediatorPhase(): BasePhase {
  return Reflect.construct(SimplePhase, ['bind-api-mediator', BIND_EXEC]);
}

export default createBindApiMediatorPhase;
export { createBindApiMediatorPhase };
