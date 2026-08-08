/**
 * Generic pre-scrape BOOTSTRAP driver for the ApiDirectScrape phase.
 * Runs the shape's optional `bootstrap` step once (after prime, before
 * the customer step): dispatches a signed POST via the shared machinery,
 * hands the response to `extractPatch`, and MERGES the returned patch
 * into the mediator session-context (never replaces — post-login
 * identity fields must survive). Zero bank-name coupling.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IApiMediator } from '../../Mediator/Api/ApiMediator.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { dispatchStep } from './ApiDirectScrapeDispatch.js';
import { buildBootstrapDispatchArgs, type IDriverCtx } from './ApiDirectScrapeDispatchArgs.js';
import type {
  ApiBody,
  IApiDirectScrapeBootstrapStep,
  SessionContextPatch,
} from './IApiDirectScrapeShape.js';

/**
 * Merge a bootstrap patch into the current session-context and store it.
 * Reads-then-sets so the mediator's replace-semantics setter keeps the
 * post-login identity fields (`uId`, `token`, `deviceId16Hex`) intact.
 * @param bus - Mediator whose session-context is patched.
 * @param patch - Fields to overlay onto the current context.
 * @returns False when the mediator refused to store the merged context.
 */
function mergeSessionContext(bus: IApiMediator, patch: SessionContextPatch): boolean {
  const current = bus.getSessionContext();
  return bus.setSessionContext({ ...current, ...patch });
}

/**
 * Reported when the mediator refuses the merged session-context. The
 * bootstrap's whole purpose is to deposit request-signing material, so
 * a silent skip would let every later read run unsigned and fail with
 * an opaque bank-side rejection instead of naming the real cause.
 */
const MERGE_REFUSED_MSG =
  'bootstrap patch was rejected by the mediator session-context — the ' +
  'material the following requests sign with was never stored';

/**
 * Apply the bootstrap step's extractor to the response body and merge
 * the resulting patch into session-context. Fail-closed: a failed
 * extraction aborts the scrape (the reads it enables would 401 anyway).
 * @param d - Driver context.
 * @param step - The shape's bootstrap step literal.
 * @param body - Parsed bootstrap response body.
 * @returns Void procedure (failure aborts the scrape).
 */
function applyBootstrapPatch<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  step: IApiDirectScrapeBootstrapStep,
  body: ApiBody,
): Procedure<void> {
  const patch = step.extractPatch({ body, ctx: d.ctx });
  if (!isOk(patch)) return patch;
  const wasStored = mergeSessionContext(d.bus, patch.value);
  if (!wasStored) return fail(ScraperErrorTypes.Generic, MERGE_REFUSED_MSG);
  return succeed(undefined);
}

/**
 * Run the shape's optional bootstrap step. No-op (success) when the
 * shape declares none, preserving every non-PayBox bank.
 * @param d - Driver context.
 * @returns Void procedure (failure aborts the scrape).
 */
async function runBootstrap<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): Promise<Procedure<void>> {
  const step = d.shape.bootstrap;
  if (step === undefined) return succeed(undefined);
  const args = buildBootstrapDispatchArgs(d, step);
  const resp = await dispatchStep(args);
  if (!isOk(resp)) return resp;
  return applyBootstrapPatch(d, step, resp.value);
}

export default runBootstrap;
