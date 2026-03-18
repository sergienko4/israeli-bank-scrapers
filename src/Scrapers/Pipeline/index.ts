/**
 * Pipeline barrel export — public API surface.
 */

// Types
export type { INone, ISome, Option } from './Types/Option.js';
export { isSome, none, some, unwrapOr } from './Types/Option.js';
export type { IPhaseDefinition, IPipelineStep, PhaseName } from './Types/Phase.js';
export type {
  IBrowserState,
  IDashboardState,
  IDiagnosticsState,
  ILoginState,
  IPipelineContext,
  IScrapeState,
} from './Types/PipelineContext.js';
export type { IProcedureFailure, IProcedureSuccess, Procedure } from './Types/Procedure.js';
export { fail, failWithDetails, fromLegacy, isOk, succeed, toLegacy } from './Types/Procedure.js';

// Strategy
export { BrowserFetchStrategy } from './Strategy/BrowserFetchStrategy.js';
export type { IFetchOpts, IFetchStrategy } from './Strategy/FetchStrategy.js';
export { DEFAULT_FETCH_OPTS } from './Strategy/FetchStrategy.js';
export { GraphQLFetchStrategy } from './Strategy/GraphQLFetchStrategy.js';
export { NativeFetchStrategy } from './Strategy/NativeFetchStrategy.js';

// Mediator
export { createElementMediator } from './Mediator/CreateElementMediator.js';
export type { IElementMediator } from './Mediator/ElementMediator.js';

// Pipeline
export type { DirectPostLoginFn, NativeLoginFn, ScrapeFn } from './PipelineBuilder.js';
export { PipelineBuilder } from './PipelineBuilder.js';
export type { IPipelineDescriptor } from './PipelineDescriptor.js';
export { executePipeline } from './PipelineExecutor.js';
export type { PipelineBuildFn } from './PipelineScraper.js';
export { PipelineScraper } from './PipelineScraper.js';

// Registry
export type { PipelineFactory } from './PipelineRegistry.js';
export { PIPELINE_REGISTRY } from './PipelineRegistry.js';
