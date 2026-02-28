import { type Frame, type Page } from 'playwright';
import { getDebug } from './debug';
import { type FieldConfig, type SelectorCandidate } from '../scrapers/login-config';

const debug = getDebug('selector-resolver');

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
    // NOTE: ariaLabel 'קוד' removed — too broad, matches unrelated elements
    // (e.g. carousel buttons with aria-label containing "הקודם").
    // Round 4 iframe search handles banks where the OTP form is cross-origin.
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

/**
 * Extract the most likely WELL_KNOWN_SELECTORS key from a CSS selector string.
 *
 * Used when `LoginOptions.fields` entries don't carry an explicit `credentialKey`.
 * Maps common Israeli bank CSS id patterns to the canonical keys used in
 * WELL_KNOWN_SELECTORS so Round 3 can find the field even if the CSS id changes.
 *
 * Examples: '#userCode' → 'userCode',  '#tzPassword' → 'password',
 *           '#aidnum' → 'num',  'input[placeholder="סיסמה"]' → 'password'
 */
export function extractCredentialKey(selector: string): string {
  const id = selector.match(/^#([a-zA-Z0-9_-]+)/)?.[1] ?? selector;
  const lower = id.toLowerCase();
  if (lower.includes('password') || lower.includes('sisma') || lower === 'tzpassword') return 'password';
  if (lower === 'usercode' || lower.includes('username') || lower.includes('usernum')) return 'username';
  if (lower === 'uid' || lower === 'tzid' || (lower.startsWith('id') && lower.length <= 4)) return 'id';
  if (lower === 'aidnum' || lower === 'num' || lower.includes('account')) return 'num';
  return id; // no canonical match — WELL_KNOWN_SELECTORS lookup returns [] (Round 3 skipped)
}

/**
 * Try each candidate on `ctx` with a per-candidate timeout.
 * Returns the first CSS string that resolves within CANDIDATE_TIMEOUT_MS, or null.
 * Times out quickly so Round 4 iframe search doesn't hang on slow/detached frames.
 * Exported so OTP detection helpers can reuse it for OTP submit button search.
 */
export async function tryInContext(ctx: Page | Frame, candidates: SelectorCandidate[]): Promise<string | null> {
  for (const candidate of candidates) {
    const css = candidateToCss(candidate);
    try {
      const el = await Promise.race([
        ctx.$(css),
        new Promise<null>(resolve => setTimeout(() => resolve(null), CANDIDATE_TIMEOUT_MS)),
      ]);
      if (el) {
        debug('resolved %s "%s" → %s', candidate.kind, candidate.value, css);
        return css;
      }
      debug('candidate %s "%s" → not found (timeout or absent)', candidate.kind, candidate.value);
    } catch {
      debug('candidate %s "%s" → skipped (cross-origin / detached frame)', candidate.kind, candidate.value);
    }
  }
  return null;
}

/**
 * The resolved location of a login field: the CSS selector that found it,
 * and the Page/Frame context it lives in (may differ from the caller's context
 * when the field is inside an iframe).
 */
export type FieldContext = {
  selector: string;
  context: Page | Frame;
};

/**
 * Resolve a FieldConfig to a selector + context pair.
 *
 * Resolution order:
 *   Round 1+2: bank-configured selectors (field.selectors) — in current page/frame
 *   Round 3:   global WELL_KNOWN_SELECTORS — in current page/frame
 *   Round 4:   same candidates in every accessible child iframe
 *              (only applies when pageOrFrame is a full Page)
 *
 * Throws a clear, actionable error listing every candidate tried if nothing resolves.
 */
export async function resolveFieldContext(
  pageOrFrame: Page | Frame,
  field: FieldConfig,
  pageUrl: string,
): Promise<FieldContext> {
  const allCandidates: SelectorCandidate[] = [...field.selectors, ...(WELL_KNOWN_SELECTORS[field.credentialKey] ?? [])];

  // Rounds 1-3: search in the provided page/frame
  debug('resolving "%s" on %s (Rounds 1-3)', field.credentialKey, pageUrl);
  const main = await tryInContext(pageOrFrame, allCandidates);
  if (main) {
    debug('resolved "%s" via Rounds 1-3: %s', field.credentialKey, main);
    return { selector: main, context: pageOrFrame };
  }

  const tried = allCandidates.map(c => `  ${c.kind} "${c.value}" → NOT FOUND`);

  // Round 4: search inside accessible child iframes (Page only, not Frame)
  if (isPage(pageOrFrame)) {
    const childFrames = pageOrFrame.frames().filter(f => f !== pageOrFrame.mainFrame());
    if (childFrames.length > 0) {
      debug('Round 4: searching %d iframe(s) for "%s"', childFrames.length, field.credentialKey);
    }
    for (const frame of childFrames) {
      const found = await tryInContext(frame, allCandidates);
      if (found) {
        debug('Round 4: resolved "%s" in iframe %s → %s', field.credentialKey, frame.url(), found);
        return { selector: found, context: frame };
      }
    }
    if (childFrames.length > 0) {
      tried.push(`  [Round 4: searched ${childFrames.length} iframe(s)] → NOT FOUND`);
    }
  }

  let pageTitle = '(unknown)';
  try {
    pageTitle = await (pageOrFrame as Page).title();
  } catch {
    // frame or page already closed — ignore
  }

  throw new Error(
    `Could not find '${field.credentialKey}' field on ${pageUrl}\n` +
      `Tried ${tried.length} candidates:\n` +
      tried.join('\n') +
      `\nPage title: "${pageTitle}"\n` +
      'This usually means the bank redesigned their login page.\n' +
      `Run: npx ts-node scripts/inspect-bank-login.ts --url '${pageUrl}' to re-detect selectors.`,
  );
}

/**
 * Convenience wrapper: resolve a field and return only the CSS selector string.
 * Uses resolveFieldContext internally (Rounds 1-4 including iframe search).
 *
 * @deprecated Prefer resolveFieldContext when the caller needs to know which
 * frame/iframe the element lives in (e.g. GenericBankScraper.fillInputs).
 */
export async function resolveSelector(pageOrFrame: Page | Frame, field: FieldConfig, pageUrl: string): Promise<string> {
  const { selector } = await resolveFieldContext(pageOrFrame, field, pageUrl);
  return selector;
}
