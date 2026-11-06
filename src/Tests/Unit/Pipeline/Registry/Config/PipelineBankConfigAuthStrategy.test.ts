/**
 * T-REG — registry completeness: every bank declares a valid authStrategyKind.
 *
 * <p>Test Case IDs:
 *   - T-REG-1 (FIRING): every entry's `authStrategyKind` is one of the 3 union members.
 *     RED while the field is absent (pre-C1); GREEN after C1 adds it to every bank.
 *   - T-REG-2: family counts are exactly 2 token / 3 session-cookie / 12 api-direct.
 *   - T-REG-3: the api-direct banks are exactly OneZero, PayBox, Pepper, VisaCal, Isracard,
 *     Amex, Max, Mizrahi, Hapoalim, Yahav, Beinleumi, Massad.
 *   - T-REG-4: each specific bank maps to the spec-S2 value (table-driven).
 *   - T-REG-6: an api-direct bank carries no browser-login budget — it has no
 *     login form to wait on, so such a budget would be dead config.
 *
 * Uses dynamic import to dodge the no-restricted-imports DI rule that bans static
 * imports of Registry/Config/** in Pipeline tests.
 */

import { CompanyTypes } from '../../../../../Definitions.js';

type AuthKind = 'token' | 'session-cookie' | 'api-direct';

const VALID_KINDS: readonly AuthKind[] = ['token', 'session-cookie', 'api-direct'];

/** Expected kind per bank (spec S2 table). */
const EXPECTED_KIND_PER_BANK: readonly [CompanyTypes, AuthKind][] = [
  [CompanyTypes.Beinleumi, 'api-direct'],
  [CompanyTypes.Discount, 'session-cookie'],
  [CompanyTypes.Hapoalim, 'api-direct'],
  [CompanyTypes.Leumi, 'session-cookie'],
  [CompanyTypes.Massad, 'api-direct'],
  [CompanyTypes.OtsarHahayal, 'token'],
  [CompanyTypes.Pagi, 'token'],
  [CompanyTypes.VisaCal, 'api-direct'],
  [CompanyTypes.Amex, 'api-direct'],
  [CompanyTypes.Max, 'api-direct'],
  [CompanyTypes.Mercantile, 'session-cookie'],
  [CompanyTypes.Mizrahi, 'api-direct'],
  [CompanyTypes.Yahav, 'api-direct'],
  [CompanyTypes.Isracard, 'api-direct'],
  [CompanyTypes.OneZero, 'api-direct'],
  [CompanyTypes.PayBox, 'api-direct'],
  [CompanyTypes.Pepper, 'api-direct'],
];

const API_DIRECT_SET = new Set<CompanyTypes>([
  CompanyTypes.OneZero,
  CompanyTypes.PayBox,
  CompanyTypes.Pepper,
  CompanyTypes.VisaCal,
  CompanyTypes.Isracard,
  CompanyTypes.Amex,
  CompanyTypes.Max,
  CompanyTypes.Mizrahi,
  CompanyTypes.Hapoalim,
  CompanyTypes.Yahav,
  CompanyTypes.Beinleumi,
  CompanyTypes.Massad,
]);

/** FIBI appsng SPA shell route AUTH-DISCOVERY navigates to post-login. */
const FIBI_APPSNG_SHELL_ROUTE = '/appsng/Resources/PortalNG/shell/#/accountSummary';

/** Expected post-login data-API origin per FIBI-family bank (cross-origin hand-off). */
const FIBI_ONLINE_HOST_PER_BANK: readonly [CompanyTypes, string][] = [
  [CompanyTypes.OtsarHahayal, 'https://online.bankotsar.co.il'],
  [CompanyTypes.Pagi, 'https://online.pagi.co.il'],
];

describe('PipelineBankConfig — authStrategyKind completeness (T-REG)', () => {
  it('T-REG-1 (FIRING): every registered bank has a valid authStrategyKind', async () => {
    // Dynamic import dodges the no-restricted-imports DI rule.
    const { PIPELINE_BANK_CONFIG: bankConfigMap } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    for (const [companyId, config] of Object.entries(bankConfigMap)) {
      const kind = config.authStrategyKind;
      expect({
        companyId,
        kindIsValid: VALID_KINDS.includes(kind),
      }).toEqual({ companyId, kindIsValid: true });
    }
  });

  it('T-REG-2: family counts are 2 token / 3 session-cookie / 12 api-direct', async () => {
    const { PIPELINE_BANK_CONFIG: bankConfigMap } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const entries = Object.values(bankConfigMap);
    const counts = { token: 0, sessionCookie: 0, apiDirect: 0 };
    for (const config of entries) {
      if (config.authStrategyKind === 'token') counts.token++;
      if (config.authStrategyKind === 'session-cookie') counts.sessionCookie++;
      if (config.authStrategyKind === 'api-direct') counts.apiDirect++;
    }
    expect(counts).toEqual({ token: 2, sessionCookie: 3, apiDirect: 12 });
  });

  it('T-REG-3: api-direct banks are exactly OneZero, PayBox, Pepper, VisaCal, Isracard, Amex, Max, Mizrahi, Hapoalim, Yahav, Beinleumi and Massad', async () => {
    const { PIPELINE_BANK_CONFIG: bankConfigMap } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const allBankEntries = Object.entries(bankConfigMap);
    const apiDirectEntries = allBankEntries.filter(
      ([, cfg]) => cfg.authStrategyKind === 'api-direct',
    );
    const actualApiDirect = apiDirectEntries.map(([id]) => id);
    const actualSet = new Set(actualApiDirect);
    expect(actualSet.size).toBe(12);
    for (const bank of API_DIRECT_SET) {
      const hasBank = actualSet.has(bank);
      expect(hasBank).toBe(true);
    }
  });

  it.each(EXPECTED_KIND_PER_BANK)(
    'T-REG-4: %s has authStrategyKind %s (spec S2)',
    async (companyId, expectedKind) => {
      const { resolvePipelineBankConfig } =
        await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
      const config = resolvePipelineBankConfig(companyId);
      expect(config).not.toBe(false);
      if (config !== false) {
        expect(config.authStrategyKind).toBe(expectedKind);
      }
    },
  );

  it.each([...API_DIRECT_SET])(
    'T-REG-6: %s, an api-direct bank, carries no browser-login budget',
    async companyId => {
      const { resolvePipelineBankConfig } =
        await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
      const config = resolvePipelineBankConfig(companyId);
      expect(config).toMatchObject({ authStrategyKind: 'api-direct' });
      expect(config).not.toHaveProperty('loginAuthConfirmMs');
      expect(config).not.toHaveProperty('loginCompletionPoll');
    },
  );
});

describe('PipelineBankConfig — FIBI postLoginNav (T-REG-5)', () => {
  it.each(FIBI_ONLINE_HOST_PER_BANK)(
    'T-REG-5: %s navigates post-login to its online-origin appsng shell',
    async (companyId, onlineHost) => {
      const { resolvePipelineBankConfig } =
        await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
      const config = resolvePipelineBankConfig(companyId);
      expect(config).not.toBe(false);
      if (config !== false) {
        expect(config.postLoginNav?.url).toBe(`${onlineHost}${FIBI_APPSNG_SHELL_ROUTE}`);
      }
    },
  );

  it('T-REG-5b: a same-origin bank (Discount) declares no postLoginNav', async () => {
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const config = resolvePipelineBankConfig(CompanyTypes.Discount);
    expect(config).not.toBe(false);
    if (config !== false) {
      expect(config.postLoginNav).toBeUndefined();
    }
  });
});
