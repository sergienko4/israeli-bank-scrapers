/**
 * Beinleumi mocked portal pages: the static fields the login-form post carries
 * and the page the servlet answers.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type { IFibiMockBrand } from './BeinleumiBrands.js';

/**
 * The hidden fields the login form carries; the client fills the user and
 * the Transmit token. They are static on the real page, so the client no
 * longer reads the page to learn them.
 * @param brand - The bank.
 * @returns The fields.
 */
export function formFieldsOf(brand: IFibiMockBrand): Readonly<Record<string, string>> {
  return {
    isPaymentProc: 'false',
    KODSAFA: 'HE',
    userLoginHome: 'Private',
    bankId: brand.portalId,
    showCaptcha: 'false',
    lang: 'HE',
  };
}

/**
 * The page the servlet answers once it accepts the token.
 * @returns The HTML page.
 */
export function logonPage(): string {
  return (
    '<!DOCTYPE html><html lang="he"><head><title>SYN</title></head>' +
    '<body><div id="syn-shell">SYN portal</div></body></html>'
  );
}
