/**
 * SelectorResolver — barrel that re-exports the split sibling modules
 * (xpath synthesis, credential-key narrowing, candidate probing, and
 * the resolution entry points). Public surface preserved.
 */

export { extractCredentialKey, isPage } from './SelectorResolver.credKey.js';
export {
  resolveDashboardField,
  resolveFieldContext,
  resolveFieldWithCache,
} from './SelectorResolver.entries.js';
export { queryWithTimeout } from './SelectorResolver.probe.js';
export { tryInContext, tryInContextInternal } from './SelectorResolver.try.js';
export type { ICachedResolveOpts, IDashboardFieldOpts } from './SelectorResolver.types.js';
export { candidateToCss, toXpathLiteral } from './SelectorResolver.xpath.js';
export type { IFieldContext } from './SelectorResolverPipeline.js'; // re-export
