/**
 * Phase and step types for the pipeline.
 * Each phase has pre/action/post hooks, each returning Procedure<T>.
 */

import type { Option } from './Option.js';
import type { IPipelineContext } from './PipelineContext.js';
import type { Procedure } from './Procedure.js';

/** The six standard pipeline phases. */
type PhaseName = 'init' | 'home' | 'login' | 'otp' | 'dashboard' | 'scrape' | 'terminate';

/** A single executable step within a phase. */
interface IPipelineStep<TIn, TOut> {
  readonly name: string;
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
