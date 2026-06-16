/**
 * Main-page-search helpers for SelectorResolverPipeline.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { getDebug } from '../../Types/Debug.js';
import { tryInContextInternal } from './SelectorResolver.try.js';
import { toFieldContext } from './SelectorResolverPipeline.context.js';
import type {
  IFieldContext,
  IFieldMatch,
  IResolveAllOpts,
} from './SelectorResolverPipeline.types.js';

const LOG = getDebug(import.meta.url);

/**
 * Emit the FOUND log row for a successful main-context match.
 * @param credentialKey - Credential key for logging.
 * @returns Sentinel `true` so the call can be expression-chained.
 */
function logMainFound(credentialKey: string): true {
  LOG.debug({ field: credentialKey, result: 'FOUND' });
  return true;
}

/** Raw return from tryInContextInternal — selector + optional kind. */
interface IRawMainHit {
  /** Resolved CSS selector. */
  readonly css: string;
  /** Optional candidate kind. */
  readonly kind?: SelectorCandidate['kind'];
}

/**
 * Pack a successful main-context match into IFieldMatch (with FOUND log).
 * @param main - Result from tryInContextInternal.
 * @param pageOrFrame - Resolution context.
 * @param credentialKey - Credential key (for logging).
 * @returns Field-match payload.
 */
function packMainMatch(
  main: IRawMainHit,
  pageOrFrame: Page | Frame,
  credentialKey: string,
): IFieldMatch {
  logMainFound(credentialKey);
  return { selector: main.css, context: pageOrFrame, kind: main.kind };
}

/**
 * Resolve a field in the main page context (Round 2).
 * @param pageOrFrame - The Page or Frame context to query in.
 * @param allCandidates - The ordered list of selector candidates to try.
 * @param credentialKey - The credential key being resolved (for logging).
 * @returns A field match result (selector is empty string if not found).
 */
async function resolveInMainContext(
  pageOrFrame: Page | Frame,
  allCandidates: SelectorCandidate[],
  credentialKey: string,
): Promise<IFieldMatch> {
  LOG.debug({ message: 'Round 2: searching main page' });
  const main = await tryInContextInternal(pageOrFrame, allCandidates);
  if (!main.css) return { selector: '', context: pageOrFrame };
  return packMainMatch(main, pageOrFrame, credentialKey);
}

/** Options for trying a candidate group in the main page context. */
interface IMainGroupOpts {
  /** Page or Frame to probe. */
  readonly ctx: Page | Frame;
  /** Candidate list. */
  readonly candidates: SelectorCandidate[];
  /** Credential key (for logging). */
  readonly credentialKey: string;
  /** resolvedVia label for matches. */
  readonly via: IFieldContext['resolvedVia'];
}

/**
 * Try a single candidate group in the main page context.
 * @param opts - The main group options.
 * @returns A IFieldContext if found, or empty field match.
 */
async function tryMainGroup(opts: IMainGroupOpts): Promise<IFieldContext | IFieldMatch> {
  if (opts.candidates.length === 0) return { selector: '', context: opts.ctx };
  const result = await resolveInMainContext(opts.ctx, opts.candidates, opts.credentialKey);
  if (result.selector) return toFieldContext(result, opts.via, 'mainPage');
  return { selector: '', context: opts.ctx };
}

/**
 * Probe the main page context for a matching field.
 * @param opts - The resolve options containing page, field, and candidates.
 * @returns A IFieldContext if found, or empty field match.
 */
async function probeMainPage(opts: IResolveAllOpts): Promise<IFieldContext | IFieldMatch> {
  const base = { ctx: opts.pageOrFrame, credentialKey: opts.field.credentialKey };
  const bankResult = await tryMainGroup({
    ...base,
    candidates: opts.bankCandidates,
    via: 'bankConfig',
  });
  if ('isResolved' in bankResult) return bankResult;
  return tryMainGroup({ ...base, candidates: opts.wellKnownCandidates, via: 'wellKnown' });
}

export { probeMainPage, resolveInMainContext };
