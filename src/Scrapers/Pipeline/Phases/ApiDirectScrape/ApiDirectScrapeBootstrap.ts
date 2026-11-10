/**
 * Generic pre-scrape BOOTSTRAP driver for the ApiDirectScrape phase.
 * Runs the shape's optional `bootstrap` — one step or an ordered list —
 * once (after prime, before the customer step). Each step dispatches a
 * signed POST via the shared machinery, hands the response to
 * `extractPatch`, and MERGES the returned patch into the mediator
 * session-context (never replaces — post-login identity fields must
 * survive) before the next step starts. Zero bank-name coupling.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { dispatchStep } from './ApiDirectScrapeDispatch.js';
import { buildBootstrapDispatchArgs, type IDriverCtx } from './ApiDirectScrapeDispatchArgs.js';
import { mergeSessionContext } from './ApiDirectScrapeSessionMerge.js';
import type {
  ApiBody,
  IApiDirectScrapeBootstrapStep,
  IApiDirectScrapeShape,
} from './IApiDirectScrapeShape.js';
import { guardShapeProcedure } from './ShapeGuard.js';

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
  const patch = guardShapeProcedure('bootstrap.extractPatch', () =>
    step.extractPatch({ body, ctx: d.ctx }),
  );
  if (!isOk(patch)) return patch;
  const wasStored = mergeSessionContext(d.bus, patch.value);
  if (!wasStored) return fail(ScraperErrorTypes.Generic, MERGE_REFUSED_MSG);
  return succeed(undefined);
}

/** The bootstrap slot as a shape declares it: one step or a list. */
type BootstrapSpec = IApiDirectScrapeShape<unknown, unknown>['bootstrap'];

/** Pending result of the steps run so far. */
type StepsDone = Promise<Procedure<void>>;

/**
 * Narrow a declared bootstrap to its list form.
 * @param spec - Declared bootstrap (never undefined here).
 * @returns True when the shape declared an ordered list.
 */
function isStepList(
  spec: NonNullable<BootstrapSpec>,
): spec is readonly IApiDirectScrapeBootstrapStep[] {
  return Array.isArray(spec);
}

/**
 * Normalise the declared bootstrap to an ordered list of steps.
 * @param spec - Declared bootstrap, if any.
 * @returns Steps to run, in order (empty when none is declared).
 */
function toStepList(spec: BootstrapSpec): readonly IApiDirectScrapeBootstrapStep[] {
  if (spec === undefined) return [];
  if (isStepList(spec)) return spec;
  return [spec];
}

/**
 * Dispatch one bootstrap step and merge its patch into session-context.
 * @param d - Driver context.
 * @param step - The bootstrap step to run.
 * @returns Void procedure (failure aborts the scrape).
 */
async function runOneStep<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  step: IApiDirectScrapeBootstrapStep,
): Promise<Procedure<void>> {
  const args = buildBootstrapDispatchArgs(d, step);
  const resp = await dispatchStep(args);
  if (!isOk(resp)) return resp;
  return applyBootstrapPatch(d, step, resp.value);
}

/**
 * Run the shape's bootstrap steps in order. Each step starts only after the
 * previous one merged its patch, so a later body can read an earlier patch;
 * the first failure stops the chain. No bootstrap declared ⇒ success.
 * @param d - Driver context.
 * @returns Void procedure (failure aborts the scrape).
 */
async function runBootstrap<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): Promise<Procedure<void>> {
  const steps = toStepList(d.shape.bootstrap);
  const none = succeed(undefined);
  const seed: StepsDone = Promise.resolve(none);
  return steps.reduce(async (prev, step): StepsDone => {
    const done = await prev;
    if (!isOk(done)) return done;
    return runOneStep(d, step);
  }, seed);
}

export default runBootstrap;
