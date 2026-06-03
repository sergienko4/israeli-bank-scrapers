/**
 * Build IResolveAllOpts from raw inputs (page + field + candidate pair).
 */

import type { Frame, Page } from 'playwright-core';

import type { IFieldCandidates } from './PipelineFieldResolver.types.js';
import type { IResolveAllOpts } from './SelectorResolverPipeline.js';

/**
 * Get the current URL safely from a Page or Frame.
 * @param pageOrFrame - Playwright Page or Frame.
 * @returns URL string, or empty string for frames.
 */
function getContextUrl(pageOrFrame: Page | Frame): string {
  if (!('url' in pageOrFrame)) return '';
  return (pageOrFrame as Page).url();
}

/** Args bundle for buildResolveOpts (keeps signature single-line). */
interface IBuildOptsArgs {
  /** Page or Frame to search in. */
  readonly pageOrFrame: Page | Frame;
  /** Credential key (logger label). */
  readonly fieldKey: string;
  /** Bank/well-known candidate pair. */
  readonly candidates: IFieldCandidates;
}

/**
 * Build IResolveAllOpts from page, field key, and candidate pair.
 * @param args - {@link IBuildOptsArgs} bundle (pageOrFrame/fieldKey/candidates).
 * @returns IResolveAllOpts ready for probing.
 */
function buildResolveOpts(args: IBuildOptsArgs): IResolveAllOpts {
  const field = { credentialKey: args.fieldKey, selectors: [...args.candidates.bank] };
  return {
    pageOrFrame: args.pageOrFrame,
    field,
    pageUrl: getContextUrl(args.pageOrFrame),
    bankCandidates: [...args.candidates.bank],
    wellKnownCandidates: [...args.candidates.wk],
  };
}

export { buildResolveOpts, getContextUrl };
export type { IBuildOptsArgs };
