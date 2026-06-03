/**
 * Not-found diagnostic builder for SelectorResolverPipeline.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { getDebug } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type {
  IFieldContext,
  IResolveAllOpts,
  TriedList,
} from './SelectorResolverPipeline.types.js';

const LOG = getDebug(import.meta.url);

/** Diagnostic constants for not-found message hints. */
const INSPECT_SCRIPT = 'npx ts-node scripts/inspect-bank-login.ts';
const REDESIGN_NOTE = 'This usually means the bank redesigned their login page.';

/**
 * Get the page title safely, returning '(unknown)' on failure.
 * @param pageOrFrame - The Page or Frame to get the title from.
 * @returns The page title string.
 */
async function getPageTitle(pageOrFrame: Page | Frame): Promise<string> {
  try {
    return await (pageOrFrame as Page).title();
  } catch {
    return '(unknown)';
  }
}

/** Context for building a not-found diagnostic message. */
interface INotFoundContext {
  /** Credential key that failed. */
  credentialKey: string;
  /** Page URL where resolution was attempted. */
  pageUrl: string;
  /** Formatted tried-candidate strings. */
  tried: TriedList;
  /** Page title for diagnostics. */
  pageTitle: string;
}

/**
 * Build a human-readable diagnostic message when a field cannot be found.
 * @param ctx - The not-found context with credential key, URL, and tried candidates.
 * @returns A multiline diagnostic message string.
 */
function buildNotFoundMessage(ctx: INotFoundContext): string {
  const { credentialKey, pageUrl, tried, pageTitle } = ctx;
  const header = `Could not find '${credentialKey}' field on ${pageUrl}`;
  const summary = `Tried ${String(tried.length)} candidates:\n${tried.join('\n')}`;
  const titleLine = `Page title: "${pageTitle}"`;
  const cmdHint = `Run: ${INSPECT_SCRIPT} --url '${pageUrl}' to re-detect selectors.`;
  return [header, summary, titleLine, REDESIGN_NOTE, cmdHint].join('\n');
}

/**
 * Log all tried candidates when resolution fails.
 * @param key - The credential key that failed to resolve.
 * @param tried - The formatted candidate strings that were tried.
 * @returns True after logging completes.
 */
function logTriedCandidates(key: string, tried: TriedList): boolean {
  LOG.debug({ field: key, result: 'NOT_FOUND' });
  for (const line of tried) LOG.debug({ message: maskVisibleText(line) });
  return true;
}

/**
 * Format tried candidates into diagnostic strings.
 * @param bankCandidates - The bank-specific selector candidates.
 * @param wellKnownCandidates - The global fallback selector candidates.
 * @returns An array of formatted diagnostic strings.
 */
function formatTriedCandidates(
  bankCandidates: SelectorCandidate[],
  wellKnownCandidates: SelectorCandidate[],
): TriedList {
  return [...bankCandidates, ...wellKnownCandidates].map(
    candidate => `  ${candidate.kind} "${candidate.value}" → NOT found`,
  );
}

/**
 * Create a not-resolved IFieldContext with a diagnostic message.
 * @param context - The Page or Frame where resolution was attempted.
 * @param message - The diagnostic message explaining why resolution failed.
 * @returns A IFieldContext with isResolved=false.
 */
function buildNotResolvedResult(context: Page | Frame, message: string): IFieldContext {
  return {
    isResolved: false,
    selector: '',
    context,
    resolvedVia: 'notResolved',
    round: 'notResolved',
    message,
  };
}

/**
 * Build a not-found IFieldContext with diagnostic details.
 * @param opts - The resolve options containing page, field, and candidates.
 * @returns A IFieldContext with isResolved=false and a diagnostic message.
 */
async function buildNotFoundContext(opts: IResolveAllOpts): Promise<IFieldContext> {
  const { pageOrFrame, field, pageUrl } = opts;
  const tried = formatTriedCandidates(opts.bankCandidates, opts.wellKnownCandidates);
  logTriedCandidates(field.credentialKey, tried);
  const pageTitle = await getPageTitle(pageOrFrame);
  const ctx = { credentialKey: field.credentialKey, pageUrl, tried, pageTitle };
  const msg = buildNotFoundMessage(ctx);
  LOG.debug({ message: maskVisibleText(msg) });
  return buildNotResolvedResult(pageOrFrame, msg);
}

export default buildNotFoundContext;

export { buildNotFoundContext };
