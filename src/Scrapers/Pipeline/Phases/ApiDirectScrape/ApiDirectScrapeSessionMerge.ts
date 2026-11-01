/**
 * Session-context merge for the ApiDirectScrape phase: overlays a patch on
 * the mediator's current session-context, so the fields a patch does not
 * name — the post-login identity (`uId`, `token`, `deviceId16Hex`) —
 * survive. Shared by the bootstrap patches and the response session (N31).
 */

import type { IApiMediator } from '../../Mediator/Api/ApiMediator.js';
import type { SessionContextPatch } from './IApiDirectScrapeShape.js';

/**
 * Merge a patch into the current session-context and store it.
 * Reads-then-sets so the mediator's replace-semantics setter keeps the
 * fields the patch does not name.
 * @param bus - Mediator whose session-context is patched.
 * @param patch - Fields to overlay onto the current context.
 * @returns False when the mediator refused to store the merged context.
 */
function mergeSessionContext(bus: IApiMediator, patch: SessionContextPatch): boolean {
  const current = bus.getSessionContext();
  return bus.setSessionContext({ ...current, ...patch });
}

export default mergeSessionContext;
export { mergeSessionContext };
