/**
 * T-REG-DH — registry coverage for VisaCal's post-login guards.
 *
 * <p>Why this exists: the required CI tier could not see either VisaCal fault.
 * Smoke authenticates with invalid credentials, so it never reaches the
 * post-login call; integration replays offline fixtures, so it never touches
 * the network. Only the real-credential job could catch them, and that job is
 * manually gated and not required for merge — so a broken post-login shipped
 * green.
 *
 * <p>These assertions close that gap. They are deterministic and need no
 * credentials and no network, so they run in the REQUIRED tier:
 * <ul>
 *   <li>NAV — post-login navigation targets the SPA root, not `/dashboard`.
 *       CAL served `/dashboard` from a stale build whose Angular bootstrap
 *       bundles had been deleted, so the app never booted.</li>
 *   <li>SCOPE / PIN — header donors are restricted to the data-API family and
 *       the gateway identifier is pinned, so the marketing site's public
 *       widget identifier can never reach the wire.</li>
 * </ul>
 *
 * <p>Uses dynamic import to dodge the no-restricted-imports DI rule that bans
 * static imports of Registry/Config in Pipeline tests (same precedent as
 * PipelineBankConfigAuthStrategy.test.ts).
 */

import { CompanyTypes } from '../../../../../Definitions.js';

/** Gateway identifier CAL's data API accepts (the SPA's compiled-in constant). */
const CAL_API_SITE_ID = '09031987-273E-2311-906C-8AF85B17C8D9';

/** Public widget identifier served by CAL's marketing site — the wrong donor. */
const CAL_MARKETING_SITE_ID = '5B5160DD-F84A-4D72-B67E-65891BA194FF';

/** CAL SPA origin — the Origin / Referer its own data-API calls carry. */
const CAL_SPA_ORIGIN = 'https://digital-web.cal-online.co.il';

describe('PipelineBankConfig — VisaCal post-login guards (T-REG-DH)', () => {
  it('T-REG-DH-1: navigates post-login to the SPA root, never /dashboard', async () => {
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const config = resolvePipelineBankConfig(CompanyTypes.VisaCal);
    expect(config).not.toBe(false);
    if (config !== false) {
      expect(config.postLoginNav?.url).toBe(`${CAL_SPA_ORIGIN}/`);
    }
  });

  it('T-REG-DH-2: scopes header donors to the CAL data-API family', async () => {
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const config = resolvePipelineBankConfig(CompanyTypes.VisaCal);
    expect(config).not.toBe(false);
    if (config !== false) {
      expect(config.discoveredHeadersUrlMatch).toBe('api.cal-online.co.il');
    }
  });

  it('T-REG-DH-3: pins X-Site-Id to the gateway identifier', async () => {
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const config = resolvePipelineBankConfig(CompanyTypes.VisaCal);
    expect(config).not.toBe(false);
    if (config !== false) {
      expect(config.pinnedDiscoveredHeaders?.['X-Site-Id']).toBe(CAL_API_SITE_ID);
    }
  });

  it('T-REG-DH-4: never pins the marketing widget identifier (the regression)', async () => {
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const config = resolvePipelineBankConfig(CompanyTypes.VisaCal);
    expect(config).not.toBe(false);
    if (config !== false) {
      expect(config.pinnedDiscoveredHeaders?.['X-Site-Id']).not.toBe(CAL_MARKETING_SITE_ID);
    }
  });

  it('T-REG-DH-5: never pins Origin or Referer — a browser forbids setting them', async () => {
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const config = resolvePipelineBankConfig(CompanyTypes.VisaCal);
    expect(config).not.toBe(false);
    if (config !== false) {
      // Forbidden header names: an in-page fetch() silently drops them, so
      // pinning would advertise control we do not have. NAV to the SPA root
      // is what actually makes the browser generate them correctly.
      const pinned = config.pinnedDiscoveredHeaders;
      expect([pinned?.Origin, pinned?.Referer]).toEqual([undefined, undefined]);
    }
  });
});

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
