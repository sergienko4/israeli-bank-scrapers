/**
 * Entry points: resolveFieldContext, resolveFieldWithCache, resolveDashboardField.
 * Composes the iframe → main-context → not-found pipeline from the
 * SelectorResolverPipeline sibling.
 */

import type { Frame, Page } from 'playwright-core';

import type { IFieldConfig, SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import {
  WELL_KNOWN_DASHBOARD_SELECTORS,
  WELL_KNOWN_LOGIN_SELECTORS,
} from '../../../Registry/WellKnownSelectors.js';
import { getDebug } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { isPage } from './SelectorResolver.credKey.js';
import type { ICachedResolveOpts, IDashboardFieldOpts } from './SelectorResolver.types.js';
import {
  buildNotFoundContext,
  type IFieldContext,
  type IResolveAllOpts,
  probeIframes,
  probeMainPage,
} from './SelectorResolverPipeline.js';

const LOG = getDebug(import.meta.url);

/** Global login-field fallback dictionary. */
const WELL_KNOWN_SELECTORS = WELL_KNOWN_LOGIN_SELECTORS as Record<string, SelectorCandidate[]>;

/**
 * Emit the "resolving" diagnostic line at the start of resolveAll.
 * @param opts - Resolve options.
 * @returns Sentinel `true` so the call can be expression-chained.
 */
function logResolveStart(opts: IResolveAllOpts): true {
  const bankCount = String(opts.bankCandidates.length);
  const wkCount = String(opts.wellKnownCandidates.length);
  const masked = maskVisibleText(opts.pageUrl);
  const key = opts.field.credentialKey;
  LOG.debug({ message: `resolving "${key}": ${bankCount}b+${wkCount}wk on ${masked}` });
  return true;
}

/**
 * Try iframes first when the context is a full Page; otherwise skip Round 1.
 * @param opts - Resolve options.
 * @returns Iframe result when matched, false otherwise.
 */
async function tryIframeRound(opts: IResolveAllOpts): Promise<IFieldContext | false> {
  if (!isPage(opts.pageOrFrame)) return false;
  const iframeResult = await probeIframes(opts.pageOrFrame, opts);
  if ('isResolved' in iframeResult) return iframeResult;
  return false;
}

/**
 * Run the full resolution pipeline: iframes first, then main context.
 * @param opts - The resolve options containing page, field, candidates, and page URL.
 * @returns A IFieldContext with resolution details.
 */
async function resolveAll(opts: IResolveAllOpts): Promise<IFieldContext> {
  logResolveStart(opts);
  const iframeResult = await tryIframeRound(opts);
  if (iframeResult) return iframeResult;
  const mainResult = await probeMainPage(opts);
  if ('isResolved' in mainResult) return mainResult;
  return buildNotFoundContext(opts);
}

/**
 * Lookup the well-known candidate list for a credential key (empty if none).
 * @param key - Credential key.
 * @returns Mutable copy of the well-known list.
 */
function wellKnownFor(key: string): SelectorCandidate[] {
  return [...(WELL_KNOWN_SELECTORS[key] ?? [])];
}

/** Inputs for {@link buildLoginOpts}. */
interface ILoginOptsArgs {
  pageOrFrame: Page | Frame;
  field: IFieldConfig;
  pageUrl: string;
}

/**
 * Build standard IResolveAllOpts from a field config and page context.
 * @param args - Page/frame, field, and URL bundled.
 * @returns Resolve options ready for resolveAll.
 */
function buildLoginOpts(args: ILoginOptsArgs): IResolveAllOpts {
  const bankCandidates = [...args.field.selectors];
  const wellKnownCandidates = wellKnownFor(args.field.credentialKey);
  return { ...args, bankCandidates, wellKnownCandidates };
}

/**
 * Resolve a login field to a selector + context pair using the full pipeline.
 * @param pageOrFrame - The Playwright Page or Frame to search in.
 * @param field - The field configuration with credential key and selectors.
 * @param pageUrl - The current page URL (for diagnostics).
 * @returns A IFieldContext with resolution details.
 */
async function resolveFieldContext(
  pageOrFrame: Page | Frame,
  field: IFieldConfig,
  pageUrl: string,
): Promise<IFieldContext> {
  const opts = buildLoginOpts({ pageOrFrame, field, pageUrl });
  return resolveAll(opts);
}

/**
 * Resolve with pre-cached frames from stepParseLoginPage.
 * @param opts - The cached resolve options including page, field, URL, and cached frames.
 * @returns A IFieldContext with resolution details.
 */
async function resolveFieldWithCache(opts: ICachedResolveOpts): Promise<IFieldContext> {
  const bankCandidates = [...opts.field.selectors];
  const wellKnownCandidates = wellKnownFor(opts.field.credentialKey);
  return resolveAll({ ...opts, bankCandidates, wellKnownCandidates });
}

/**
 * Build IResolveAllOpts for a dashboard field resolution call.
 * @param args - Dashboard field options.
 * @param wellKnown - Resolved dashboard well-known candidates.
 * @returns Resolve options ready for resolveAll.
 */
function buildDashboardOpts(
  args: IDashboardFieldOpts,
  wellKnown: readonly SelectorCandidate[],
): IResolveAllOpts {
  const bankCandidates = [...args.bankCandidates];
  const field: IFieldConfig = { credentialKey: args.fieldKey, selectors: bankCandidates };
  return { ...args, field, bankCandidates, wellKnownCandidates: [...wellKnown] };
}

/**
 * Resolve a dashboard data field using the same pipeline as login resolution.
 * @param opts - The dashboard field options including page, field key, candidates, and URL.
 * @returns A IFieldContext with resolution details.
 */
async function resolveDashboardField(opts: IDashboardFieldOpts): Promise<IFieldContext> {
  const dashboard = WELL_KNOWN_DASHBOARD_SELECTORS as Record<string, SelectorCandidate[]>;
  const wellKnown: SelectorCandidate[] = dashboard[opts.fieldKey] ?? [];
  const dashboardOpts = buildDashboardOpts(opts, wellKnown);
  return resolveAll(dashboardOpts);
}

export { resolveDashboardField, resolveFieldContext, resolveFieldWithCache };
