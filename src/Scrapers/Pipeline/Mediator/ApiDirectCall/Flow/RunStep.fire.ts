/**
 * Step fire — sends a prepared step through the bus by its HTTP method. A
 * POST carries the prepared body; a GET carries only the query, the headers
 * and the Set-Cookie sink.
 */

import type { IApiQueryOpts } from '../../../Types/Domain/ApiQueryOpts.js';
import type { StepMethod } from '../ConfigContracts/index.js';
import type { IFireArgs, IRunStepArgs, JsonValue, Procedure } from './RunStep.types.js';

/** Sends one prepared step and returns its parsed response. */
type FireStep = (args: IRunStepArgs, fire: IFireArgs) => Promise<Procedure<JsonValue>>;

/**
 * Map the fire bundle onto the bus's per-call options.
 * @param fire - Fire-call bundle.
 * @returns Headers, query and Set-Cookie sink for the bus.
 */
function toBusOpts(fire: IFireArgs): IApiQueryOpts {
  return { extraHeaders: fire.extraHeaders, query: fire.query, onSetCookie: fire.onSetCookie };
}

/**
 * POST the prepared body.
 * @param args - Run-step args.
 * @param fire - Fire-call bundle.
 * @returns Procedure with the parsed response JSON.
 */
async function firePost(args: IRunStepArgs, fire: IFireArgs): Promise<Procedure<JsonValue>> {
  const opts = toBusOpts(fire);
  return args.bus.apiPost<JsonValue>(args.step.urlTag, fire.body, opts);
}

/**
 * GET without a body.
 * @param args - Run-step args.
 * @param fire - Fire-call bundle.
 * @returns Procedure with the parsed response JSON.
 */
async function fireGet(args: IRunStepArgs, fire: IFireArgs): Promise<Procedure<JsonValue>> {
  const opts = toBusOpts(fire);
  return args.bus.apiGet<JsonValue>(args.step.urlTag, opts);
}

/** Bus call per step method. */
const FIRE_BY_METHOD: Readonly<Record<StepMethod, FireStep>> = { POST: firePost, GET: fireGet };

/**
 * Send a prepared step with its method's bus call; no method means POST.
 * @param args - Run-step args.
 * @param fire - Fire-call bundle.
 * @returns Procedure with the parsed response JSON.
 */
async function fireStep(args: IRunStepArgs, fire: IFireArgs): Promise<Procedure<JsonValue>> {
  const method = args.step.method ?? 'POST';
  return FIRE_BY_METHOD[method](args, fire);
}

export default fireStep;
export { fireStep };
