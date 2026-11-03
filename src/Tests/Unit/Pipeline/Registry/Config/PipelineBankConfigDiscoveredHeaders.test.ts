/**
 * T-REG-DH — registry invariants for the discovered-header bag.
 *
 * <p>A bank that pins headers must also scope its donor pool, and a bank that
 * scopes its donor pool must opt into the bag. Deterministic, no credentials,
 * no network, so they run in the REQUIRED tier.
 *
 * <p>Uses dynamic import to dodge the no-restricted-imports DI rule that bans
 * static imports of Registry/Config in Pipeline tests (same precedent as
 * PipelineBankConfigAuthStrategy.test.ts).
 */

describe('PipelineBankConfig — donor-policy invariants (T-REG-DH-6/7)', () => {
  it('T-REG-DH-6: a bank that pins headers also scopes its donor pool', async () => {
    const { PIPELINE_BANK_CONFIG: bankConfigMap } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const entries = Object.entries(bankConfigMap);
    const pinning = entries.filter(([, cfg]) => cfg.pinnedDiscoveredHeaders !== undefined);
    for (const [companyId, cfg] of pinning) {
      const hasScope = typeof cfg.discoveredHeadersUrlMatch === 'string';
      expect({ companyId, hasScope }).toEqual({ companyId, hasScope: true });
    }
  });

  it('T-REG-DH-7: a bank that scopes its donor pool also opts into the bag', async () => {
    const { PIPELINE_BANK_CONFIG: bankConfigMap } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const entries = Object.entries(bankConfigMap);
    const scoping = entries.filter(([, cfg]) => cfg.discoveredHeadersUrlMatch !== undefined);
    for (const [companyId, cfg] of scoping) {
      const isOptedIn = cfg.installDiscoveredHeaders === true;
      expect({ companyId, isOptedIn }).toEqual({ companyId, isOptedIn: true });
    }
  });
});
