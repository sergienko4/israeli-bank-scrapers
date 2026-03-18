/** Default timezone for Israeli bank portals. */
export const ISRAEL_TIMEZONE = 'Asia/Jerusalem';

/** Default locale for Israeli bank portals and date formatting. */
export const ISRAEL_LOCALE = 'he-IL';

/**
 * Fixed 1920×1080 viewport for all bank portals.
 * Some banks (e.g. Beinleumi) hide login elements at smaller sizes.
 */
export const DEFAULT_VIEWPORT: Readonly<{ width: number; height: number }> = Object.freeze({
  width: 1920,
  height: 1080,
});
