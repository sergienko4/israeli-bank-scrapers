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
export { BrowserFetchStrategy } from './Strategy/Fetch/BrowserFetchStrategy.js';
export type { IFetchOpts, IFetchStrategy } from './Strategy/Fetch/FetchStrategy.js';
export { DEFAULT_FETCH_OPTS } from './Strategy/Fetch/FetchStrategy.js';
export { GraphQLFetchStrategy } from './Strategy/Fetch/GraphQLFetchStrategy.js';
export { NativeFetchStrategy } from './Strategy/Fetch/NativeFetchStrategy.js';

// Mediator
export { createElementMediator } from './Mediator/Elements/CreateElementMediator.js';
export type { IElementMediator } from './Mediator/Elements/ElementMediator.js';

// Pipeline
export type { DirectPostLoginFn, NativeLoginFn, ScrapeFn } from './Core/PipelineBuilder.js';
export { PipelineBuilder } from './Core/PipelineBuilder.js';
export type { IPipelineDescriptor } from './Core/PipelineDescriptor.js';
export { executePipeline } from './Core/PipelineExecutor.js';
export type { PipelineBuildFn } from './Core/PipelineScraper.js';
export { PipelineScraper } from './Core/PipelineScraper.js';

// Registry
export type { PipelineFactory } from './Core/PipelineRegistry.js';
export { PIPELINE_REGISTRY } from './Core/PipelineRegistry.js';
