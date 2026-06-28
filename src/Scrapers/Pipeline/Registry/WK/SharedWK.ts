/**
 * Shared WK constants — phase-neutral candidates consumed across phases.
 * CLOSE_POPUP clears overlays before discovery; LOADING is the generic
 * "page is still loading" spinner probe (NOT a dashboard-specific marker)
 * so any phase can read it without coupling to another phase's WK.
 */

/** Popup close candidates — used by every PRE step. */
const WK_CLOSE_POPUP = [
  { kind: 'exactText', value: 'סגור' },
  { kind: 'exactText', value: 'close' },
  { kind: 'exactText', value: 'ביטול' },
  { kind: 'exactText', value: '✕' },
  { kind: 'ariaLabel', value: 'סגור' },
  { kind: 'ariaLabel', value: 'close' },
  // Bank Leumi cookie-consent close control. Its visible text is the
  // multi-line "× \n\n  סגירה" (verbatim) and its accessible name is the
  // aria-label "כפתור סגירה חלון cookies" — so NONE of the candidates above
  // can match it (text differs from exact 'סגור'; the × glyph is U+00D7,
  // not the U+2715 '✕' above). 'סגירה' (closing) matches it two ways:
  // ariaLabel → getByRole('button', { name, exact:false }) substring-matches
  // the accessible name; exactText → the inner 'סגירה' text node. Captured
  // live from www.leumi.co.il/he. See Elements/Create/Locators.ts.
  { kind: 'ariaLabel', value: 'סגירה' },
  { kind: 'exactText', value: 'סגירה' },
] as const;

/**
 * Generic loading-spinner candidates. The Hebrew label "טוען" ("loading")
 * is a cross-bank progress indicator — both aria-labelled and text-content
 * spinners are listed so callers honour either shape.
 */
const WK_LOADING = [
  { kind: 'ariaLabel', value: 'טוען' },
  { kind: 'textContent', value: 'טוען' },
] as const;

export default WK_CLOSE_POPUP;
export { WK_CLOSE_POPUP, WK_LOADING };
