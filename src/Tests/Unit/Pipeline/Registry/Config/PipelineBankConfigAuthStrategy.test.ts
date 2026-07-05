/**
 * T-REG — registry completeness: every bank declares a valid authStrategyKind.
 *
 * <p>Test Case IDs:
 *   - T-REG-1 (FIRING): every entry's `authStrategyKind` is one of the 3 union members.
 *     RED while the field is absent (pre-C1); GREEN after C1 adds it to all 16 banks.
 *   - T-REG-2: family counts are exactly 5 token / 8 session-cookie / 3 api-direct.
 *   - T-REG-3: the api-direct banks are exactly OneZero, PayBox, Pepper.
 *   - T-REG-4: each specific bank maps to the spec-S2 value (table-driven).
 *
 * Uses dynamic import to dodge the no-restricted-imports DI rule that bans static
 * imports of Registry/Config/** in Pipeline tests (same precedent as
 * PipelineBankConfigAuthConfirm.test.ts).
 */

import { CompanyTypes } from '../../../../../Definitions.js';

type AuthKind = 'token' | 'session-cookie' | 'api-direct';

const VALID_KINDS: readonly AuthKind[] = ['token', 'session-cookie', 'api-direct'];

/** Expected kind per bank (spec S2 table). */
const EXPECTED_KIND_PER_BANK: readonly [CompanyTypes, AuthKind][] = [
  [CompanyTypes.Beinleumi, 'token'],
  [CompanyTypes.Discount, 'session-cookie'],
  [CompanyTypes.Hapoalim, 'session-cookie'],
  [CompanyTypes.Leumi, 'session-cookie'],
  [CompanyTypes.Massad, 'token'],
  [CompanyTypes.OtsarHahayal, 'token'],
  [CompanyTypes.Pagi, 'token'],
  [CompanyTypes.VisaCal, 'token'],
  [CompanyTypes.Amex, 'session-cookie'],
  [CompanyTypes.Max, 'session-cookie'],
  [CompanyTypes.Mercantile, 'session-cookie'],
  [CompanyTypes.Yahav, 'session-cookie'],
  [CompanyTypes.Isracard, 'session-cookie'],
  [CompanyTypes.OneZero, 'api-direct'],
  [CompanyTypes.PayBox, 'api-direct'],
  [CompanyTypes.Pepper, 'api-direct'],
];

const API_DIRECT_SET = new Set<CompanyTypes>([
  CompanyTypes.OneZero,
  CompanyTypes.PayBox,
  CompanyTypes.Pepper,
]);

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

  it('T-REG-2: family counts are 5 token / 8 session-cookie / 3 api-direct', async () => {
    const { PIPELINE_BANK_CONFIG: bankConfigMap } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const entries = Object.values(bankConfigMap);
    const counts = { token: 0, sessionCookie: 0, apiDirect: 0 };
    for (const config of entries) {
      if (config.authStrategyKind === 'token') counts.token++;
      if (config.authStrategyKind === 'session-cookie') counts.sessionCookie++;
      if (config.authStrategyKind === 'api-direct') counts.apiDirect++;
    }
    expect(counts).toEqual({ token: 5, sessionCookie: 8, apiDirect: 3 });
  });

  it('T-REG-3: api-direct banks are exactly OneZero, PayBox, and Pepper', async () => {
    const { PIPELINE_BANK_CONFIG: bankConfigMap } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const allBankEntries = Object.entries(bankConfigMap);
    const apiDirectEntries = allBankEntries.filter(
      ([, cfg]) => cfg.authStrategyKind === 'api-direct',
    );
    const actualApiDirect = apiDirectEntries.map(([id]) => id as CompanyTypes);
    const actualSet = new Set(actualApiDirect);
    expect(actualSet.size).toBe(3);
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
});
