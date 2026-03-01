import { type Frame, type Page } from 'playwright';

import { type FieldConfig, type SelectorCandidate } from '../Scrapers/LoginConfig';
import { getDebug } from './Debug';

const DEBUG = getDebug('selector-resolver');

/**
 * Global dictionary of well-known Hebrew display-name selectors for each credential key.
 * Tried in Round 3 (after the bank's configured selectors) for every bank automatically.
 */
const WELL_KNOWN_SELECTORS: Record<string, SelectorCandidate[]> = {
  username: [
    { kind: 'placeholder', value: 'שם משתמש' },
    { kind: 'placeholder', value: 'קוד משתמש' },
    { kind: 'placeholder', value: 'מספר לקוח' },
    { kind: 'placeholder', value: 'תז' },
    { kind: 'ariaLabel', value: 'שם משתמש' },
    { kind: 'ariaLabel', value: 'קוד משתמש' },
    { kind: 'name', value: 'username' },
    { kind: 'name', value: 'userCode' },
  ],
  userCode: [
    { kind: 'placeholder', value: 'קוד משתמש' },
    { kind: 'placeholder', value: 'שם משתמש' },
    { kind: 'placeholder', value: 'מספר לקוח' },
    { kind: 'ariaLabel', value: 'קוד משתמש' },
    { kind: 'name', value: 'userCode' },
    { kind: 'name', value: 'username' },
  ],
  password: [
    { kind: 'placeholder', value: 'סיסמה' },
    { kind: 'placeholder', value: 'סיסמא' },
    { kind: 'placeholder', value: 'קוד סודי' },
    { kind: 'ariaLabel', value: 'סיסמה' },
    { kind: 'name', value: 'password' },
    { kind: 'css', value: 'input[type="password"]' },
  ],
  id: [
    { kind: 'placeholder', value: 'תעודת זהות' },
    { kind: 'placeholder', value: 'מספר זהות' },
    { kind: 'placeholder', value: 'ת.ז' },
    { kind: 'ariaLabel', value: 'תעודת זהות' },
    { kind: 'name', value: 'id' },
  ],
  nationalID: [
    { kind: 'placeholder', value: 'תעודת זהות' },
    { kind: 'placeholder', value: 'מספר זהות' },
    { kind: 'ariaLabel', value: 'תעודת זהות' },
    { kind: 'name', value: 'nationalID' },
    { kind: 'name', value: 'id' },
  ],
  card6Digits: [
    { kind: 'placeholder', value: '6 ספרות' },
    { kind: 'placeholder', value: 'ספרות הכרטיס' },
    { kind: 'ariaLabel', value: 'ספרות הכרטיס' },
  ],
  num: [
    { kind: 'placeholder', value: 'מספר חשבון' },
    { kind: 'ariaLabel', value: 'מספר חשבון' },
    { kind: 'name', value: 'num' },
  ],
  otpCode: [
    { kind: 'placeholder', value: 'קוד חד פעמי' },
    { kind: 'placeholder', value: 'קוד SMS' },
    { kind: 'placeholder', value: 'קוד אימות' },
    { kind: 'placeholder', value: 'הזן קוד' },
    { kind: 'name', value: 'otpCode' },
  ],
};

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
  const id = selector.match(/^#([a-zA-Z0-9_-]+)/)?.[1] ?? selector;
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
    new Promise<null>(resolve => setTimeout(() => resolve(null), CANDIDATE_TIMEOUT_MS)),
  ]);
  return el !== null && el !== undefined;
}

function debugCandidateSkipped(candidate: SelectorCandidate): void {
  DEBUG(
    'candidate %s "%s" → skipped (cross-origin / detached frame)',
    candidate.kind,
    candidate.value,
  );
}

async function probeCandidate(
  ctx: Page | Frame,
  candidate: SelectorCandidate,
): Promise<string | null> {
  const css = candidateToCss(candidate);
  try {
    const isFound = await queryWithTimeout(ctx, css);
    if (isFound) {
      DEBUG('resolved %s "%s" → %s', candidate.kind, candidate.value, css);
      return css;
    }
    DEBUG('candidate %s "%s" → not found (timeout or absent)', candidate.kind, candidate.value);
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
 * The resolved location of a login field.
 */
export type FieldContext = {
  selector: string;
  context: Page | Frame;
};

async function searchInChildFrames(
  page: Page,
  allCandidates: SelectorCandidate[],
  tried: string[],
): Promise<FieldContext | null> {
  const childFrames = page.frames().filter(f => f !== page.mainFrame());
  if (childFrames.length > 0) DEBUG('Round 4: searching %d iframe(s)', childFrames.length);
  for (const frame of childFrames) {
    const found = await tryInContext(frame, allCandidates);
    if (found) {
      DEBUG('Round 4: resolved in iframe %s → %s', frame.url(), found);
      return { selector: found, context: frame };
    }
  }
  if (childFrames.length > 0)
    tried.push(`  [Round 4: searched ${childFrames.length} iframe(s)] → NOT FOUND`);
  return null;
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
): Promise<FieldContext | null> {
  const main = await tryInContext(pageOrFrame, allCandidates);
  if (!main) return null;
  DEBUG('resolved "%s" via Rounds 1-3: %s', credentialKey, main);
  return { selector: main, context: pageOrFrame };
}

interface ResolveIframesOpts {
  pageOrFrame: Page | Frame;
  field: FieldConfig;
  pageUrl: string;
  allCandidates: SelectorCandidate[];
}

async function resolveInIframesOrThrow(opts: ResolveIframesOpts): Promise<FieldContext> {
  const { pageOrFrame, field, pageUrl, allCandidates } = opts;
  const tried = allCandidates.map(c => `  ${c.kind} "${c.value}" → NOT FOUND`);
  if (isPage(pageOrFrame)) {
    const iframeResult = await searchInChildFrames(pageOrFrame, allCandidates, tried);
    if (iframeResult) return iframeResult;
  }
  const msg = buildNotFoundMessage({
    credentialKey: field.credentialKey,
    pageUrl,
    tried,
    pageTitle: await getPageTitle(pageOrFrame),
  });
  throw new Error(msg);
}

export async function resolveFieldContext(
  pageOrFrame: Page | Frame,
  field: FieldConfig,
  pageUrl: string,
): Promise<FieldContext> {
  const allCandidates: SelectorCandidate[] = [
    ...field.selectors,
    ...(WELL_KNOWN_SELECTORS[field.credentialKey] ?? []),
  ];
  DEBUG('resolving "%s" on %s (Rounds 1-3)', field.credentialKey, pageUrl);
  const main = await resolveInMainContext(pageOrFrame, allCandidates, field.credentialKey);
  if (main) return main;
  return resolveInIframesOrThrow({ pageOrFrame, field, pageUrl, allCandidates });
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
