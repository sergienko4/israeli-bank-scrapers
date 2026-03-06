import { type Page } from 'playwright';

import { getDebug } from './Debug';

const LOG = getDebug('navigation');

/**
 * Waits for the page to be genuinely ready before any form interaction.
 * Applies to login forms, OTP screens, and any bank-specific step forms.
 *
 * Two sequential checks (A + C):
 *   A) networkidle  — network resources have settled (no requests for 500ms)
 *   C) DOM state    — readyState complete + Angular ReactiveForm directives bound (if Angular)
 *
 * Angular detection: looks for ng-version attribute or .ng-star-inserted class.
 * If Angular is detected, waits for the first <form> to show ng-untouched/ng-invalid —
 * classes ReactiveFormsModule adds during CSR hydration (absent from SSR-rendered HTML
 * in preboot/SSR-swap mode, which is the common Angular Universal pattern).
 *
 * Never throws — both steps have independent timeouts with .catch(() => null) fallback.
 * Call before any fillInput / clickButton sequence on a form.
 *
 * @param page - the Playwright Page to wait on
 */
async function waitForPageStability(page: Page): Promise<void> {
  // A: wait for network to settle
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => null);

  // C: wait for DOM completion + framework form readiness
  await page
    .waitForFunction(
      () => {
        if (document.readyState !== 'complete') return false;
        const isAngularPage =
          !!document.querySelector('[ng-version]') || !!document.querySelector('.ng-star-inserted');
        if (!isAngularPage) return true; // not Angular — readyState is sufficient
        // Angular: ReactiveFormsModule adds ng-untouched/ng-invalid after CSR hydration
        const form = document.querySelector('form');
        if (!form) return true;
        return form.classList.contains('ng-untouched') || form.classList.contains('ng-invalid');
      },
      { timeout: 5_000 },
    )
    .catch(() => null);
  LOG.info('waitForPageStability: complete');
}

export default waitForPageStability;
