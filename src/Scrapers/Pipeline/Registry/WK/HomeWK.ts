/**
 * HOME phase WK constants — login entry points only.
 * NO reveal toggles — those belong to PRE-LOGIN (PreLoginWK.ts).
 * Isolated: NO imports from PreLogin, Login, Dashboard, or Scrape WK.
 */

/** HOME phase WK — entry points that navigate to the login page. */
export const WK_HOME = {
  /** Links/buttons that take the browser to the login page or open login modal. */
  ENTRY: [
    { kind: 'textContent', value: 'כניסה לחשבון' },
    { kind: 'textContent', value: 'כניסה לאיזור האישי' },
    { kind: 'textContent', value: 'כניסה והרשמה' },
    { kind: 'textContent', value: 'התחברות' },
    { kind: 'textContent', value: 'כניסה' },
    { kind: 'textContent', value: 'החשבון שלי' },
    { kind: 'ariaLabel', value: 'כניסה לחשבון' },
  ],
  /** Menu/dropdown items revealed after clicking a toggle ENTRY. */
  MENU: [
    { kind: 'ariaLabel', value: 'כניסה לאזור אישי - לקוחות פרטיים' },
    { kind: 'textContent', value: 'לקוחות פרטיים' },
  ],
  /** Form field readiness indicators — used by PRE-LOGIN.POST to detect form load. */
  FORM_CHECK: [
    { kind: 'labelText', value: 'תעודת זהות' },
    { kind: 'labelText', value: 'מספר זהות' },
    { kind: 'labelText', value: 'שם משתמש' },
    { kind: 'placeholder', value: 'תעודת זהות' },
    { kind: 'placeholder', value: 'שם משתמש' },
    { kind: 'placeholder', value: 'ת.ז' },
    { kind: 'name', value: 'id' },
    { kind: 'name', value: 'username' },
  ],
} as const;
export default WK_HOME;
