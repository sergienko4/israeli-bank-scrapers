/**
 * Phase and step types for the pipeline.
 * Each phase has pre/action/post hooks, each returning Procedure<T>.
 */

import type { Option } from './Option.js';
import type { IPipelineContext } from './PipelineContext.js';
import type { Procedure } from './Procedure.js';

/** Name identifier for a pipeline step (e.g. 'login', 'scrape-pre'). */
type StepNameStr = string;

/** The pipeline phases in execution order. */
type PhaseName =
  | 'init'
  | 'home'
  | 'find-login-area'
  | 'login'
  | 'otp'
  | 'dashboard'
  | 'scrape'
  | 'terminate';

/** A single executable step within a phase. */
interface IPipelineStep<TIn, TOut> {
  readonly name: StepNameStr;
  execute(ctx: IPipelineContext, input: TIn): Promise<Procedure<TOut>>;
}

/** A phase groups related steps with pre/action/post hooks. */
interface IPhaseDefinition<TIn, TOut> {
  readonly name: PhaseName;
  readonly pre: Option<IPipelineStep<TIn, TIn>>;
  readonly action: IPipelineStep<TIn, TOut>;
  readonly post: Option<IPipelineStep<TOut, TOut>>;
}

export type { IPhaseDefinition, IPipelineStep, PhaseName };
