/**
 * Re-exports the canonical browser-fingerprint constants from Common.
 * Single source of truth lives at src/Common/Config/BrowserConfig.ts —
 * this file exists only so existing pipeline-local imports
 * (`./BrowserConfig.js`) keep resolving without churning ~20 import
 * sites across the codebase.
 */
export {
  DESKTOP_VIEWPORT_HEIGHT,
  DESKTOP_VIEWPORT_WIDTH,
  ISRAEL_LOCALE,
  ISRAEL_TIMEZONE,
} from '../../../../Common/Config/BrowserConfig.js';
