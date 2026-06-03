/**
 * SelectorResolverPipeline — barrel that re-exports the split sibling
 * modules: types, IFieldContext mapper, not-found diagnostics, iframe
 * search, and main-page search. Public surface preserved for existing
 * consumers.
 */

export { probeIframes, searchInChildFrames } from './SelectorResolverPipeline.frames.js';
export { probeMainPage, resolveInMainContext } from './SelectorResolverPipeline.main.js';
export { buildNotFoundContext } from './SelectorResolverPipeline.notFound.js';
export type {
  IFieldContext,
  IFieldMatch,
  IResolveAllOpts,
  TriedList,
} from './SelectorResolverPipeline.types.js';
