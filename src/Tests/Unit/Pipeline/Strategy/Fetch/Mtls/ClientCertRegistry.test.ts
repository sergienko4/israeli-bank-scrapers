/**
 * Unit tests for Strategy/Fetch/Mtls/ClientCertRegistry — the per-bank client
 * certificate lookup behind `requiresClientCert`. A bank that asks for a
 * client certificate without registering one must fail when its mediator is
 * built, not reach the bank edge without a certificate.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import { resolveClientCert } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/ClientCertRegistry.js';

describe('resolveClientCert', () => {
  it('fails fast, naming the bank, when the bank registered no certificate', () => {
    /**
     * Resolve the certificate of a bank that never registered one.
     * @returns Never; the lookup throws.
     */
    const resolveUnregistered = (): ReturnType<typeof resolveClientCert> =>
      resolveClientCert(CompanyTypes.Hapoalim);
    expect(resolveUnregistered).toThrow(ScraperError);
    expect(resolveUnregistered).toThrow(/no client certificate is registered \(hapoalim\)/);
  });
});
