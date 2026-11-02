/**
 * Beinleumi mocked portal pages: the login page (its script names the bank
 * number and client address; its hidden form is what the logon posts back),
 * the hand-off page the logon answers, and the landing.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type { BeinleumiFault } from './BeinleumiFaults.js';
import { BN_CLIENT_IP, BN_HANDOFF_PATH, BN_HANDOFF_RID } from './BeinleumiMockData.js';
import { BN_BANK_NUM, ENTRY_QUERY, WIRE_PATHS } from './BeinleumiWireSpec.js';

/** The hidden fields the login form carries, before the client fills them. */
export const FORM_FIELDS = { user: '', passwordEnc: '', ...ENTRY_QUERY } as const;

/** Where the login form posts: the servlet, relative to the page. */
const ACTION = WIRE_PATHS.servlet;

/** A form the page also holds: visible, with a password field, never posted. */
const DECOY_FORM =
  '<form id="quickLogin" method="post" action="/quick">' +
  '<input type="text" name="username"><input type="password" name="password"></form>';

/** The browser marker the hand-off script tests; the client's agent lacks it. */
const APP_MARKER = 'navigator.userAgent.indexOf("SynMobileApp")>-1';

/** The app's branch: a message to the frame around the page. */
const POST_MESSAGE = 'window.parent.postMessage("syn-login","*");';

/** The web branch: the portal home. */
const TO_HOME = `window.location.href="${BN_HANDOFF_PATH}?rid=${BN_HANDOFF_RID}";`;

/** The hand-off script, before any fault: the app branch first, the web one after. */
const HANDOFF = `sessionStorage.removeItem("syn-key");\nif(${APP_MARKER}){${POST_MESSAGE}}else{${TO_HOME}}`;

/** The hand-off scripts the portal faults answer instead. */
const HANDOFF_FAULTS: Readonly<Partial<Record<BeinleumiFault, string>>> = {
  postMessageHandoff: `if(${APP_MARKER}){${TO_HOME}}else{${POST_MESSAGE}}`,
  ambiguousHandoff: `${HANDOFF}\ntop.location.href="${BN_HANDOFF_PATH}?rid=syn-rid-02";`,
  crossOriginHandoff: 'window.location.href="https://portal.example.invalid/wps/portal/home";',
};

/**
 * Wrap a body in a page.
 * @param body - The page body.
 * @returns The HTML page.
 */
function page(body: string): string {
  return `<!DOCTYPE html><html lang="he"><head><title>SYN</title></head><body>${body}</body></html>`;
}

/**
 * A hidden input.
 * @param entry - Its name and value.
 * @returns The input tag.
 */
function hiddenInput(entry: readonly [string, string]): string {
  const [name, value] = entry;
  return `<input type="hidden" name="${name}" value="${value}">`;
}

/**
 * The login page.
 * @param fault - How the run misbehaves; `noPasswordEnc` drops that field.
 * @returns The HTML page.
 */
export function loginPage(fault: BeinleumiFault): string {
  const entries = Object.entries(FORM_FIELDS);
  const kept = entries.filter(([name]) => fault !== 'noPasswordEnc' || name !== 'passwordEnc');
  const inputs = kept.map(hiddenInput).join('');
  const form = `<form id="loginServlet" name="loginServlet" method="post" action="${ACTION}">`;
  const script = `<script>var bankNum = "${BN_BANK_NUM}";\nvar client_ip = '${BN_CLIENT_IP}';</script>`;
  return page(`${script}${DECOY_FORM}${form}${inputs}</form>`);
}

/**
 * The page the logon answers: a hand-off script.
 * @param fault - How the run misbehaves.
 * @returns The HTML page.
 */
export function handoffPage(fault: BeinleumiFault): string {
  const script = HANDOFF_FAULTS[fault] ?? HANDOFF;
  return page(`<script src="/syn/shell.js"></script><script>${script}</script>`);
}

/** The portal page the hand-off lands on. */
export const LANDING_PAGE = page('<div id="syn-shell">SYN portal</div>');
