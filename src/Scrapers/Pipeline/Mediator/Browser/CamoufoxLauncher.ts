/**
 * Re-exports the canonical Camoufox launcher from Common. Single source
 * of truth lives at src/Common/CamoufoxLauncher.ts — this file exists
 * only so existing pipeline-local imports keep resolving without
 * churning every import site across the codebase.
 *
 * <p>Background (C11): the two duplicated launcher files diverged
 * silently in 2026-05-18 when commit 1708ba39 ("humanize + disable_coop
 * + virtual") was dropped during squash-merge — only Common was
 * updated in the historical record while the Pipeline-side copy
 * kept the older bare-bones options. C11 consolidates to one source
 * of truth so the next anti-detect tuning can never miss a copy.
 */
export { ISRAEL_LOCALE, launchCamoufox } from '../../../../Common/CamoufoxLauncher.js';
