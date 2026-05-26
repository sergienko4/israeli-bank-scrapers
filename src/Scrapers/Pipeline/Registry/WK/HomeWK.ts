/**
 * HOME phase WK constants — login entry points only.
 * NO reveal toggles — those belong to PRE-LOGIN (PreLoginWK.ts).
 * Isolated: NO imports from PreLogin, Login, Dashboard, or Scrape WK.
 */

/** Selector-kind discriminator strings, lifted out of every literal entry. */
const KIND_TEXT_CONTENT = 'textContent' as const;
const KIND_ARIA_LABEL = 'ariaLabel' as const;

/** Hebrew "Login to personal area" — two spelling variants used across
 *  banks ("איזור" with yod, "אזור" without). Lifted to constants so each
 *  variant is named once. */
const LABEL_PERSONAL_AREA_LOGIN_YOD = 'כניסה לאיזור האישי' as const;
const LABEL_PERSONAL_AREA_LOGIN_NOYOD = 'כניסה לאזור האישי' as const;

/** HOME phase WK — entry points that navigate to the login page. */
export const WK_HOME = {
  /** Links/buttons that take the browser to the login page or open login modal. */
  ENTRY: [
    // Longest-first: more specific candidates win when multiple match.
    { kind: KIND_TEXT_CONTENT, value: LABEL_PERSONAL_AREA_LOGIN_YOD },
    { kind: KIND_ARIA_LABEL, value: 'כניסה לחשבון שלי' },
    { kind: KIND_TEXT_CONTENT, value: 'כניסה לחשבון שלי' },
    { kind: 'exactText', value: 'כניסה לחשבונך' },
    { kind: KIND_TEXT_CONTENT, value: 'כניסה לחשבון' },
    { kind: KIND_TEXT_CONTENT, value: 'כניסה והרשמה' },
    { kind: KIND_ARIA_LABEL, value: 'החשבון שלי' },
    { kind: KIND_TEXT_CONTENT, value: 'החשבון שלי' },
    { kind: KIND_TEXT_CONTENT, value: 'התחברות' },
    { kind: KIND_ARIA_LABEL, value: 'כניסה לחשבון' },
    { kind: KIND_TEXT_CONTENT, value: 'כניסה אישית' },
    { kind: KIND_TEXT_CONTENT, value: 'כניסה' },
  ],
  /** Menu/dropdown items revealed after clicking a toggle ENTRY. */
  MENU: [
    { kind: KIND_ARIA_LABEL, value: 'כניסה לאזור אישי - לקוחות פרטיים' },
    { kind: KIND_ARIA_LABEL, value: LABEL_PERSONAL_AREA_LOGIN_NOYOD },
    { kind: KIND_ARIA_LABEL, value: LABEL_PERSONAL_AREA_LOGIN_YOD },
    { kind: KIND_TEXT_CONTENT, value: LABEL_PERSONAL_AREA_LOGIN_NOYOD },
    { kind: KIND_TEXT_CONTENT, value: LABEL_PERSONAL_AREA_LOGIN_YOD },
    { kind: KIND_TEXT_CONTENT, value: 'לקוחות פרטיים' },
  ],
  /** Form field readiness indicators — used by PRE-LOGIN.POST to detect form load. */
  FORM_CHECK: [
    { kind: 'labelText', value: 'תעודת זהות' },
    { kind: 'labelText', value: 'מספר זהות' },
    { kind: 'labelText', value: 'שם משתמש' },
    { kind: 'labelText', value: 'קוד משתמש' },
    { kind: 'placeholder', value: 'תעודת זהות' },
    { kind: 'placeholder', value: 'שם משתמש' },
    { kind: 'placeholder', value: 'קוד משתמש' },
    { kind: KIND_TEXT_CONTENT, value: 'סיסמה' },

    { kind: 'placeholder', value: 'ת.ז' },
  ],
} as const;
export default WK_HOME;
