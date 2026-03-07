import { type Frame, type Page } from 'playwright';

import { type FieldConfig, type SelectorCandidate } from '../Scrapers/Base/LoginConfig';
import { SCRAPER_CONFIGURATION } from '../Scrapers/Registry/ScraperConfig';
import { getDebug } from './Debug';

const LOG = getDebug('selector-resolver');

/** Global login-field fallback dictionary — sourced from central ScraperConfig. */
const WELL_KNOWN_SELECTORS = SCRAPER_CONFIGURATION.wellKnownSelectors as Record<
  string,
  SelectorCandidate[]
>;

/** Global dashboard-field fallback dictionary — sourced from central ScraperConfig. */
const WELL_KNOWN_DASHBOARD_SELECTORS = SCRAPER_CONFIGURATION.wellKnownDashboardSelectors as Record<
  string,
  SelectorCandidate[]
>;

/** Convert a SelectorCandidate to a Playwright-compatible selector string */
export function candidateToCss(c: SelectorCandidate): string {
  switch (c.kind) {
    case 'labelText':
      return `xpath=//label[contains(., "${c.value}")]`;
    case 'css':
      return c.value;
    case 'placeholder':
      return `input[placeholder*="${c.value}"]`;
    case 'ariaLabel':
      return `input[aria-label*="${c.value}"]`;
    case 'name':
      return `[name="${c.value}"]`;
    case 'xpath':
      return `xpath=${c.value}`;
  }
}

/** True when `pageOrFrame` is a full Page (has `frames()` method). */
function isPage(pageOrFrame: Page | Frame): pageOrFrame is Page {
  return 'frames' in pageOrFrame && typeof (pageOrFrame as unknown as Page).frames === 'function';
}

/** Max ms to wait for a single `$()` call before treating it as not found. */
const CANDIDATE_TIMEOUT_MS = 2000;

const CREDENTIAL_KEY_MAP: Record<string, string> = {
  password: 'password',
  sisma: 'password',
  tzpassword: 'password',
  usercode: 'username',
  username: 'username',
  usernum: 'username',
  uid: 'id',
  tzid: 'id',
  aidnum: 'num',
  num: 'num',
  account: 'num',
};

/**
 * Extract the most likely WELL_KNOWN_SELECTORS key from a CSS selector string.
 */
export function extractCredentialKey(selector: string): string {
  const id = /^#([a-zA-Z0-9_-]+)/.exec(selector)?.[1] ?? selector;
  const lower = id.toLowerCase();
  const directMatch = CREDENTIAL_KEY_MAP[lower];
  if (directMatch) return directMatch;
  for (const [key, val] of Object.entries(CREDENTIAL_KEY_MAP)) {
    if (lower.includes(key)) return val;
  }
  if (lower.startsWith('id') && lower.length <= 4) return 'id';
  return id;
}

async function queryWithTimeout(ctx: Page | Frame, css: string): Promise<boolean> {
  const el = await Promise.race([
    ctx.$(css),
    new Promise<null>(resolve =>
      setTimeout(() => {
        resolve(null);
      }, CANDIDATE_TIMEOUT_MS),
    ),
  ]);
  return el !== null;
}

function debugCandidateSkipped(candidate: SelectorCandidate): void {
  LOG.info(
    'candidate %s "%s" → skipped (cross-origin / detached frame)',
    candidate.kind,
    candidate.value,
  );
}

async function resolveLabelText(
  ctx: Page | Frame,
  labelXpath: string,
  labelValue: string,
): Promise<string | null> {
  const label = await ctx.$(labelXpath);
  if (!label) return null;
  const forAttr = await label.getAttribute('for');
  if (!forAttr) {
    LOG.info('labelText "%s" found but no for= attribute', labelValue);
    return null;
  }
  const inputSelector = `#${forAttr}`;
  const input = await ctx.$(inputSelector);
  if (!input) {
    LOG.info('labelText "%s" for="%s" but #%s not found', labelValue, forAttr, forAttr);
    return null;
  }
  LOG.info('resolved labelText "%s" → for="%s" → %s', labelValue, forAttr, inputSelector);
  return inputSelector;
}

async function probeCandidate(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
): Promise<string | null> {
  const css = candidateToCss(candidate);
  try {
    if (candidate.kind === 'labelText') {
      return await resolveLabelText(ctx, css, candidate.value);
    }
    const isFound = await queryWithTimeout(ctx, css);
    if (isFound) {
      LOG.info('resolved %s "%s" → %s', candidate.kind, candidate.value, css);
      return css;
    }
    LOG.info('candidate %s "%s" → NOT FOUND', candidate.kind, candidate.value);
  } catch {
    debugCandidateSkipped(candidate);
  }
  return null;
}

/**
 * Try each candidate on `ctx` with a per-candidate timeout.
 * Returns the first CSS string that resolves within CANDIDATE_TIMEOUT_MS, or null.
 */
export async function tryInContext(
  ctx: Page | Frame,
  candidates: SelectorCandidate[],
): Promise<string | null> {
  for (const candidate of candidates) {
    const found = await probeCandidate(ctx, candidate);
    if (found) return found;
  }
  return null;
}

/**
 * The resolved location of a login field — always returned, never throws.
 * Check `isResolved` before using `selector` / `context`.
 * - `resolvedVia`: 'bankConfig' (bank's own selector) | 'wellKnown' (global fallback) | 'notResolved'
 * - `round`: 'iframe' (found in child frame) | 'mainPage' (found in main context) | 'notResolved'
 */
export interface FieldContext {
  isResolved: boolean;
  selector: string;
  context: Page | Frame;
  resolvedVia: 'bankConfig' | 'wellKnown' | 'notResolved';
  round: 'iframe' | 'mainPage' | 'notResolved';
  /** Diagnostic message — populated when isResolved is false */
  message?: string;
}

/** Internal match result — callers add isResolved, resolvedVia, round.
 *  `selector` is empty string when not found (never null). */
interface FieldMatch {
  selector: string;
  context: Page | Frame;
}

async function searchInChildFrames(
  page: Page,
  allCandidates: SelectorCandidate[],
): Promise<FieldMatch> {
  const childFrames = page.frames().filter(f => f !== page.mainFrame());
  if (childFrames.length > 0) LOG.info('Round 1: searching %d iframe(s)', childFrames.length);
  for (const frame of childFrames) {
    const found = await tryInContext(frame, allCandidates);
    if (found) {
      LOG.info('Round 1: resolved in iframe %s → %s', frame.url(), found);
      return { selector: found, context: frame };
    }
  }
  return { selector: '', context: page }; // not found — caller checks selector !== ''
}

async function getPageTitle(pageOrFrame: Page | Frame): Promise<string> {
  try {
    return await (pageOrFrame as Page).title();
  } catch {
    return '(unknown)';
  }
}

/**
 * Resolve a FieldConfig to a selector + context pair.
 */
interface NotFoundContext {
  credentialKey: string;
  pageUrl: string;
  tried: string[];
  pageTitle: string;
}

function buildNotFoundMessage(ctx: NotFoundContext): string {
  const { credentialKey, pageUrl, tried, pageTitle } = ctx;
  return (
    `Could not find '${credentialKey}' field on ${pageUrl}\n` +
    `Tried ${tried.length} candidates:\n` +
    tried.join('\n') +
    `\nPage title: "${pageTitle}"\n` +
    'This usually means the bank redesigned their login page.\n' +
    `Run: npx ts-node scripts/inspect-bank-login.ts --url '${pageUrl}' to re-detect selectors.`
  );
}

async function resolveInMainContext(
  pageOrFrame: Page | Frame,
  allCandidates: SelectorCandidate[],
  credentialKey: string,
): Promise<FieldMatch> {
  LOG.info('Round 2: searching main page');
  const main = await tryInContext(pageOrFrame, allCandidates);
  if (!main) return { selector: '', context: pageOrFrame }; // not found
  LOG.info('Round 2: resolved "%s" → %s', credentialKey, main);
  return { selector: main, context: pageOrFrame };
}

/** All inputs needed to resolve a single login field. */
interface ResolveAllOpts {
  pageOrFrame: Page | Frame;
  field: FieldConfig;
  pageUrl: string;
  bankCandidates: SelectorCandidate[];
  wellKnownCandidates: SelectorCandidate[];
}

function logTriedCandidates(key: string, url: string, tried: string[]): void {
  LOG.info('FAILED "%s" on %s (%d tried)', key, url, tried.length);
  for (const line of tried) LOG.info(line);
}

async function buildNotFoundContext(opts: ResolveAllOpts): Promise<FieldContext> {
  const { pageOrFrame, field, pageUrl, bankCandidates: b, wellKnownCandidates: wk } = opts;
  const tried = [...b, ...wk].map(c => `  ${c.kind} "${c.value}" → NOT found`);
  logTriedCandidates(field.credentialKey, pageUrl, tried);
  const msg = buildNotFoundMessage({
    credentialKey: field.credentialKey,
    pageUrl,
    tried,
    pageTitle: await getPageTitle(pageOrFrame),
  });
  LOG.info(msg);
  return {
    isResolved: false,
    selector: '',
    context: pageOrFrame,
    resolvedVia: 'notResolved',
    round: 'notResolved',
    message: msg,
  };
}

async function probeIframes(
  page: Page,
  b: SelectorCandidate[],
  wk: SelectorCandidate[],
): Promise<FieldContext | null> {
  if (b.length > 0) {
    const r = await searchInChildFrames(page, b);
    if (r.selector) return { isResolved: true, ...r, resolvedVia: 'bankConfig', round: 'iframe' };
  }
  if (wk.length > 0) {
    const r = await searchInChildFrames(page, wk);
    if (r.selector) return { isResolved: true, ...r, resolvedVia: 'wellKnown', round: 'iframe' };
  }
  return null;
}

async function probeMainPage(opts: ResolveAllOpts): Promise<FieldContext | null> {
  const { pageOrFrame: ctx, bankCandidates: b, wellKnownCandidates: wk, field } = opts;
  if (b.length > 0) {
    const r = await resolveInMainContext(ctx, b, field.credentialKey);
    if (r.selector) return { isResolved: true, ...r, resolvedVia: 'bankConfig', round: 'mainPage' };
  }
  if (wk.length > 0) {
    const r = await resolveInMainContext(ctx, wk, field.credentialKey);
    if (r.selector) return { isResolved: true, ...r, resolvedVia: 'wellKnown', round: 'mainPage' };
  }
  return null;
}

function splitCandidates(field: FieldConfig): {
  bank: SelectorCandidate[];
  wellKnown: SelectorCandidate[];
} {
  return {
    bank: [...field.selectors],
    wellKnown: [...(WELL_KNOWN_SELECTORS[field.credentialKey] ?? [])],
  };
}

async function resolveAll(opts: ResolveAllOpts): Promise<FieldContext> {
  const { pageOrFrame, field, pageUrl, bankCandidates: b, wellKnownCandidates: wk } = opts;
  LOG.info(`resolving "${field.credentialKey}": ${b.length}b+${wk.length}wk on ${pageUrl}`);
  if (isPage(pageOrFrame)) {
    const r = await probeIframes(pageOrFrame, b, wk);
    if (r) return r;
  }
  const main = await probeMainPage(opts);
  if (main) return main;
  return buildNotFoundContext(opts);
}

export async function resolveFieldContext(
  pageOrFrame: Page | Frame,
  field: FieldConfig,
  pageUrl: string,
): Promise<FieldContext> {
  const { bank, wellKnown } = splitCandidates(field);
  return resolveAll({
    pageOrFrame,
    field,
    pageUrl,
    bankCandidates: bank,
    wellKnownCandidates: wellKnown,
  });
}

/**
 * Convenience wrapper: resolve a field and return only the CSS selector string.
 * @deprecated Prefer resolveFieldContext when the caller needs to know which frame the element lives in.
 */
export async function resolveSelector(
  pageOrFrame: Page | Frame,
  field: FieldConfig,
  pageUrl: string,
): Promise<string> {
  const { selector } = await resolveFieldContext(pageOrFrame, field, pageUrl);
  return selector;
}

/**
 * Extract the first CSS string from a SelectorCandidate array.
 * Use this as a backward-compatibility adapter for scrapers not yet migrated
 * to full resolveDashboardField() resolution.
 */
export function toFirstCss(candidates: SelectorCandidate[]): string {
  return candidates.length > 0 ? candidateToCss(candidates[0]) : '';
}

/** Options for resolving a post-login dashboard selector. */
export interface DashboardFieldOpts {
  pageOrFrame: Page | Frame;
  fieldKey: string;
  bankCandidates: SelectorCandidate[];
  pageUrl: string;
}

/**
 * Resolve a dashboard data field using the same round-trip as login resolution:
 * iframes first (if Page), then main context; bank candidates first, wellKnown fallback second.
 * Returns a FieldContext — check `isResolved` before using `selector` / `context`.
 */
export async function resolveDashboardField(opts: DashboardFieldOpts): Promise<FieldContext> {
  const { pageOrFrame, fieldKey, bankCandidates, pageUrl } = opts;
  const wellKnownCandidates = WELL_KNOWN_DASHBOARD_SELECTORS[fieldKey] ?? [];
  return resolveAll({
    pageOrFrame,
    field: { credentialKey: fieldKey, selectors: [...bankCandidates] },
    pageUrl,
    bankCandidates: [...bankCandidates],
    wellKnownCandidates: [...wellKnownCandidates],
  });
}
