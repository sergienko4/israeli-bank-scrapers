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
    case 'css':
      return c.value;
    case 'placeholder':
      return `input[placeholder*="${c.value}"]`;
    case 'ariaLabel':
      return `[aria-label*="${c.value}"]`;
    case 'name':
      return `[name="${c.value}"]`;
    case 'xpath':
      return `xpath=${c.value}`;
    case 'label':
      return ''; // handled by probeLabelCandidate — never reaches this path
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

/** Browser-side: scan every <label> for `text`, return a CSS selector for its input. */
function scanLabelForInput(text: string): string | null {
  const m = Array.from(document.querySelectorAll('label')).find(l => l.textContent.includes(text));
  if (!m) return null;
  const fid = m.getAttribute('for');
  if (fid && document.getElementById(fid)) return `#${fid}`;
  const ch = m.querySelector('input, textarea, select');
  if (!(ch instanceof HTMLElement)) return null;
  if (ch.id) return `#${ch.id}`;
  const n = ch.getAttribute('name');
  return n ? `[name="${n}"]` : null;
}

/** Last-resort: find input by visible <label> text. Reports found/not-found. */
async function probeLabelCandidate(ctx: Page | Frame, labelText: string): Promise<string | null> {
  try {
    const result = await ctx.evaluate(scanLabelForInput, labelText);
    if (result) LOG.info('resolved label "%s" → %s', labelText, result);
    else LOG.info('candidate label "%s" → NOT FOUND', labelText);
    return result;
  } catch {
    debugCandidateSkipped({ kind: 'label', value: labelText });
    return null;
  }
}

async function probeCandidate(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
): Promise<string | null> {
  if (candidate.kind === 'label') return probeLabelCandidate(ctx, candidate.value);
  const css = candidateToCss(candidate);
  try {
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
  return candidates.reduce(
    async (acc, candidate) => (await acc) ?? probeCandidate(ctx, candidate),
    Promise.resolve<string | null>(null),
  );
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
  const frameResults = await Promise.all(
    childFrames.map(async frame => ({ frame, found: await tryInContext(frame, allCandidates) })),
  );
  const match = frameResults.find(r => r.found !== null);
  if (match?.found) {
    LOG.info('Round 1: resolved in iframe %s → %s', match.frame.url(), match.found);
    return { selector: match.found, context: match.frame };
  }
  return { selector: '', context: page }; // not found — caller checks selector !== ''
}

async function getPageTitle(pof: Page | Frame): Promise<string> {
  try {
    return await (pof as Page).title();
  } catch {
    return '(unknown)';
  }
}

interface NotFoundContext {
  credentialKey: string;
  pageUrl: string;
  tried: string[];
  pageTitle: string;
}

function buildNotFoundMessage(ctx: NotFoundContext): string {
  const { credentialKey, pageUrl, tried, pageTitle } = ctx;
  return [
    `Could not find '${credentialKey}' field on ${pageUrl}`,
    `Tried ${tried.length} candidates:`,
    ...tried,
    `Page title: "${pageTitle}"`,
    'This usually means the bank redesigned their login page.',
    `Run: npx ts-node scripts/inspect-bank-login.ts --url '${pageUrl}' to re-detect selectors.`,
  ].join('\n');
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

async function buildNotFoundContext(opts: ResolveAllOpts): Promise<FieldContext> {
  const { pageOrFrame, field, pageUrl, bankCandidates: b, wellKnownCandidates: wk } = opts;
  const tried = [...b, ...wk].map(c => `  ${c.kind} "${c.value}" → NOT found`);
  LOG.info('FAILED "%s" on %s (%d tried)', field.credentialKey, pageUrl, tried.length);
  for (const t of tried) LOG.info(t);
  const msg = buildNotFoundMessage({
    credentialKey: field.credentialKey,
    pageUrl,
    tried,
    pageTitle: await getPageTitle(pageOrFrame),
  });
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

async function resolveAll(opts: ResolveAllOpts): Promise<FieldContext> {
  const { pageOrFrame, field, pageUrl, bankCandidates: b, wellKnownCandidates: wk } = opts;
  LOG.info(`resolving "${field.credentialKey}": ${b.length}b+${wk.length}wk on ${pageUrl}`);
  const main = await probeMainPage(opts); // main page first — avoids iframe false positives
  if (main) return main;
  if (isPage(pageOrFrame)) {
    const r = await probeIframes(pageOrFrame, b, wk); // iframes fallback
    if (r) return r;
  }
  return buildNotFoundContext(opts);
}

export async function resolveFieldContext(
  pageOrFrame: Page | Frame,
  field: FieldConfig,
  pageUrl: string,
): Promise<FieldContext> {
  const bank = [...field.selectors];
  const wellKnown = [...(WELL_KNOWN_SELECTORS[field.credentialKey] ?? [])];
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
