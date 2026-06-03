/**
 * Pipeline-aware field resolver (barrel).
 * Uses WK.LOGIN.ACTION.FORM (text-only, zero CSS) as the well-known fallback,
 * then enriches the resolved IFieldContext with DOM metadata via MetadataExtractors.
 *
 * Reuses the exported resolution primitives from SelectorResolverPipeline.ts —
 * no modification to shared infrastructure required.
 */

import type { Option } from '../../Types/Option.js';
import { logResolvedDetails } from './PipelineFieldResolver.diag.js';
import { enrichWithMetadata } from './PipelineFieldResolver.enrich.js';
import { buildResolveOpts } from './PipelineFieldResolver.opts.js';
import { probeAll } from './PipelineFieldResolver.probe.js';
import { buildScopedCandidates, resolveWkCandidates } from './PipelineFieldResolver.scope.js';
import type {
  IFieldCandidates,
  IPipelineFieldContext,
  IResolveFieldArgs,
} from './PipelineFieldResolver.types.js';

/** Bundle for resolveAndEnrich (avoids 4-positional signature). */
interface IResolveAndEnrichArgs {
  /** Original request. */
  readonly req: IResolveFieldArgs;
  /** Pre-scoped candidate pair. */
  readonly candidates: IFieldCandidates;
  /** WK concept slot Option. */
  readonly slot: Option<string>;
}

/**
 * Build the resolve-all options bundle from a resolveAndEnrich args bundle.
 * @param args - resolveAndEnrich bundle.
 * @returns Pre-built IResolveAllOpts.
 */
function asOpts(args: IResolveAndEnrichArgs): ReturnType<typeof buildResolveOpts> {
  return buildResolveOpts({
    pageOrFrame: args.req.pageOrFrame,
    fieldKey: args.req.fieldKey,
    candidates: args.candidates,
  });
}

/**
 * Resolve and enrich; emit diagnostic and return.
 * @param args - Bundled resolution arguments.
 * @returns Enriched field context.
 */
async function resolveAndEnrich(args: IResolveAndEnrichArgs): Promise<IPipelineFieldContext> {
  const opts = asOpts(args);
  const result = await probeAll(args.req.pageOrFrame, opts);
  const enriched = await enrichWithMetadata(result);
  if (enriched.isResolved) logResolvedDetails(args.req.fieldKey, enriched, args.slot);
  return enriched;
}

/**
 * Resolve a login field using pipeline text-only well-known candidates.
 * Finds the element by visible Hebrew text, then extracts DOM metadata.
 * @param args - Bundled resolution arguments.
 * @returns IPipelineFieldContext with full DOM metadata if resolved.
 */
async function resolveFieldPipeline(args: IResolveFieldArgs): Promise<IPipelineFieldContext> {
  const { slot, wellKnown } = resolveWkCandidates(args.fieldKey);
  const candidates = buildScopedCandidates(args.bankCandidates, wellKnown, args.formSelector);
  return resolveAndEnrich({ req: args, candidates, slot });
}

export type { IPipelineFieldContext, IResolveFieldArgs };
export { resolveFieldPipeline };
