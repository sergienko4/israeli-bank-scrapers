/**
 * Types-only sibling for PipelineFieldResolver.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import type { Option } from '../../Types/Option.js';
import type { IElementMetadata } from '../Elements/MetadataExtractors.js';
import type { IFieldContext } from './SelectorResolverPipeline.js';

/**
 * Extended field context returned by the pipeline resolver.
 * Adds dynamically-extracted DOM metadata after text-based resolution.
 */
interface IPipelineFieldContext extends IFieldContext {
  /** DOM metadata extracted after resolving the element by visible text. */
  readonly metadata?: IElementMetadata;
}

/** Bank and well-known candidates pair for field resolution. */
interface IFieldCandidates {
  /** Bank-specific candidates. */
  readonly bank: readonly SelectorCandidate[];
  /** Well-known candidates from the WK registry. */
  readonly wk: readonly SelectorCandidate[];
}

/** Options for resolveFieldPipeline — bundled to satisfy max-params. */
interface IResolveFieldArgs {
  /** Playwright Page or Frame to search in. */
  readonly pageOrFrame: Page | Frame;
  /** Credential key (logger label + WK lookup key). */
  readonly fieldKey: string;
  /** Bank-specific candidate list. */
  readonly bankCandidates: readonly SelectorCandidate[];
  /** Optional form-scope selector (empty / undefined = no scoping). */
  readonly formSelector?: string;
}

/** Resolved WK concept slot + candidate list pair. */
interface IWkLookup {
  /** WK concept slot when present. */
  readonly slot: Option<string>;
  /** Well-known candidates for the concept slot (empty when none). */
  readonly wellKnown: readonly SelectorCandidate[];
}
export type { IFieldCandidates, IPipelineFieldContext, IResolveFieldArgs, IWkLookup };
