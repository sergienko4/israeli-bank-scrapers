/**
 * Step fire — sends a prepared step through the bus by its HTTP method, to
 * the step's bus target (its WK tag, or its URL with a raw query). A POST
 * carries the prepared body; a GET carries only the query, the headers and
 * the Set-Cookie sink.
 */

import type { WKUrlOrLiteral } from '../../../../Registry/WK/UrlsWK.js';
import type { IApiQueryOpts } from '../../../../Types/Domain/ApiQueryOpts.js';
import type { StepMethod } from '../../ConfigContracts/index.js';
import type { IFireArgs, IRunStepArgs, JsonValue, Procedure } from './RunStep.types.js';

/** Sends one prepared step to its bus target and returns its parsed response. */
type FireStep = (
  args: IRunStepArgs,
  fire: IFireArgs,
  target: WKUrlOrLiteral,
) => Promise<Procedure<JsonValue>>;

/**
 * Map the fire bundle onto the bus's per-call options.
 * @param fire - Fire-call bundle.
 * @returns Headers, query, Set-Cookie sink and call policy for the bus.
 */
function toBusOpts(fire: IFireArgs): IApiQueryOpts {
  const { extraHeaders, query, onSetCookie, policy } = fire;
  return { extraHeaders, query, onSetCookie, policy };
}

/**
 * POST the prepared body.
 * @param args - Run-step args.
 * @param fire - Fire-call bundle.
 * @param target - Bus target.
 * @returns Procedure with the parsed response JSON.
 */
async function firePost(
  args: IRunStepArgs,
  fire: IFireArgs,
  target: WKUrlOrLiteral,
): Promise<Procedure<JsonValue>> {
  const opts = toBusOpts(fire);
  return args.bus.apiPost<JsonValue>(target, fire.body, opts);
}

/**
 * GET without a body.
 * @param args - Run-step args.
 * @param fire - Fire-call bundle.
 * @param target - Bus target.
 * @returns Procedure with the parsed response JSON.
 */
async function fireGet(
  args: IRunStepArgs,
  fire: IFireArgs,
  target: WKUrlOrLiteral,
): Promise<Procedure<JsonValue>> {
  const opts = toBusOpts(fire);
  return args.bus.apiGet<JsonValue>(target, opts);
}

/** Bus call per step method. */
const FIRE_BY_METHOD: Readonly<Record<StepMethod, FireStep>> = { POST: firePost, GET: fireGet };

/**
 * Send a prepared step with its method's bus call; no method means POST.
 * @param args - Run-step args.
 * @param fire - Fire-call bundle.
 * @param target - Bus target resolved with the signed path and query.
 * @returns Procedure with the parsed response JSON.
 */
async function fireStep(
  args: IRunStepArgs,
  fire: IFireArgs,
  target: WKUrlOrLiteral,
): Promise<Procedure<JsonValue>> {
  const method = args.step.method ?? 'POST';
  return FIRE_BY_METHOD[method](args, fire, target);
}

export default fireStep;
export { fireStep };
