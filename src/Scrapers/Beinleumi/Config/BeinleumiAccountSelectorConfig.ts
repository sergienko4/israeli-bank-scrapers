/** Playwright role selector for the account dropdown trigger (combobox). */
export const ACCOUNT_SELECTOR = 'role=combobox[name="חשבון"]';

/** Playwright role selector for the account dropdown panel. */
export const DROPDOWN_PANEL_SELECTOR = 'role=listbox';

/** Playwright role selector for individual account options. */
export const OPTION_SELECTOR = 'role=option';

/** Timeout for waiting for UI elements to render (ms). */
export const ELEMENT_RENDER_TIMEOUT_MS = 10000;

/** Name attribute of the legacy transactions iframe. */
export const IFRAME_NAME = 'iframe-old-pages';

/** Maximum attempts to load the transactions frame. */
export const TRANSACTIONS_FRAME_LOAD_ATTEMPTS = 3;

/** Delay before loading the transactions frame (ms). */
export const TRANSACTIONS_FRAME_WAIT_MS = 2000;
