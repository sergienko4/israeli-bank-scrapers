/**
 * Re-export shim for the canonical Pipeline SelectorResolver.
 *
 * @deprecated The canonical implementation lives at
 * `src/Scrapers/Pipeline/Mediator/Selector/SelectorResolver.ts`. Phase 3
 * Commit 1 (Common ↔ Pipeline unification) collapsed this file from a
 * duplicate ~426 LoC implementation into a thin re-export. All public
 * exports remain available from this path so existing Common-tree
 * callers (Leumi/BeyahadBishvilha/Yahav/Mizrahi/Base) keep compiling
 * unchanged. New code should import directly from the Pipeline path.
 * This shim will be removed in a follow-up phase once all Common
 * importers are migrated.
 *
 * Pipeline returns branded `XpathLiteralStr` / `PlaywrightSelector` /
 * `CredentialKey` from `toXpathLiteral` / `candidateToCss` /
 * `extractCredentialKey`. The wrapper functions below preserve the
 * original plain-`string` return signatures so existing Common-tree
 * call sites (legacy `Object.fromEntries(...) as Record<string, string>`
 * patterns) continue to compile. Brands erase at runtime —
 * the wrappers are simple delegates that V8 will inline.
 *
 * `IFieldContext` is compatible for current callers and is widened by
 * Pipeline (adds `'heuristic'` literal to `resolvedVia`/`round` unions).
 * No Common consumer narrows against the missing literal today.
 */
import { type SelectorCandidate } from '../Scrapers/Base/Config/LoginConfig.js';
import {
  candidateToCss as pipelineCandidateToCss,
  extractCredentialKey as pipelineExtractCredentialKey,
  toXpathLiteral as pipelineToXpathLiteral,
} from '../Scrapers/Pipeline/Mediator/Selector/SelectorResolver.js';

export type {
  ICachedResolveOpts,
  IDashboardFieldOpts,
  IFieldContext,
} from '../Scrapers/Pipeline/Mediator/Selector/SelectorResolver.js';
export {
  isPage,
  queryWithTimeout,
  resolveDashboardField,
  resolveFieldContext,
  resolveFieldWithCache,
  tryInContext,
  tryInContextInternal,
} from '../Scrapers/Pipeline/Mediator/Selector/SelectorResolver.js';

/**
 * Convert a SelectorCandidate to a Playwright-compatible selector.
 * @param candidate - The selector candidate to convert.
 * @returns The Playwright-compatible CSS or XPath selector string.
 */
export function candidateToCss(candidate: SelectorCandidate): string {
  return pipelineCandidateToCss(candidate);
}

/**
 * Escape a string for safe use as an XPath string literal.
 * @param value - The raw string value.
 * @returns The XPath-safe quoted string.
 */
export function toXpathLiteral(value: string): string {
  return pipelineToXpathLiteral(value);
}

/**
 * Extract the most likely WELL_KNOWN_SELECTORS key from a CSS selector string.
 * @param selector - A CSS selector string such as `#username` or `#tzId`.
 * @returns The normalized credential key.
 */
export function extractCredentialKey(selector: string): string {
  return pipelineExtractCredentialKey(selector);
}
