/**
 * Re-exports the canonical Camoufox launcher from Common. Single source
 * of truth lives at src/Common/CamoufoxLauncher.ts — this file exists
 * only so existing pipeline-local imports
 * (`./Mediator/Browser/CamoufoxLauncher.js`) keep resolving without
 * churning ~20 import sites across the codebase.
 */
export { ISRAEL_LOCALE, launchCamoufox } from '../../../../Common/CamoufoxLauncher.js';
