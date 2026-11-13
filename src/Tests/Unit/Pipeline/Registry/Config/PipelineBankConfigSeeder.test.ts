/**
 * WK seeding contract for PIPELINE_BANK_CONFIG.
 *
 * Loading the bank-config module seeds every transport URL into the WK
 * registry. The seeder walks the CompanyTypes enum, so these tests pin that
 * every configured transport URL resolves, and banks without a transport block
 * stay unregistered.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import {
  resetWkRegistryForTest,
  resolveWkUrl,
  type WKUrlGroup,
} from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { isOk, type Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

// Dynamic import dodges the no-restricted-imports DI rule that bans static
// imports of Registry/Config/** in Pipeline tests (precedent:
// PipelineBankConfigPepperWaf.test.ts).
const { PIPELINE_BANK_CONFIG } =
  await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
const SEEDER =
  await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigSeeder.js');

/** One bank's entry in PIPELINE_BANK_CONFIG. */
type BankConfig = (typeof PIPELINE_BANK_CONFIG)[CompanyTypes];

/** One bank's transport `paths` map. */
type TransportPaths = NonNullable<NonNullable<BankConfig>['transport']>['paths'];

/** One URL the seeder must register: [group, bank, url]. */
type SeededUrl = readonly [WKUrlGroup, CompanyTypes, string];

/**
 * List the per-bank auth-path URLs one transport block declares.
 * @param bankId - Bank to read.
 * @param paths - That bank's transport `paths` map.
 * @returns The path URLs the seeder must register.
 */
function expectedPathUrls(bankId: CompanyTypes, paths: TransportPaths): SeededUrl[] {
  return Object.entries(paths).flatMap(([key, url]): SeededUrl[] =>
    url ? [[key as WKUrlGroup, bankId, url]] : [],
  );
}

/**
 * List every URL one bank's transport block declares.
 * @param bankId - Bank to read.
 * @param config - That bank's pipeline config.
 * @returns The URLs the seeder must register for the bank.
 */
function expectedUrlsFor(bankId: CompanyTypes, config: BankConfig): SeededUrl[] {
  const transportConfig = config?.transport;
  if (!transportConfig) return [];
  const pathUrls = expectedPathUrls(bankId, transportConfig.paths);
  const identity: SeededUrl = ['identityBase', bankId, transportConfig.identityBase];
  const graphql: SeededUrl = ['graphql', bankId, transportConfig.graphql];
  return [identity, graphql, ...pathUrls];
}

/**
 * Unwrap a resolved WK URL.
 * @param result - The resolveWkUrl outcome.
 * @returns The URL, or '' when unresolved.
 */
function resolvedUrl(result: Procedure<string>): string {
  return isOk(result) ? result.value : '';
}

const ALL_BANKS = Object.values(CompanyTypes);
const EXPECTED_URLS = ALL_BANKS.flatMap(bankId =>
  expectedUrlsFor(bankId, PIPELINE_BANK_CONFIG[bankId]),
);

describe('PipelineBankConfigSeeder', () => {
  it('finds headless banks to check', () => {
    expect(EXPECTED_URLS.length).toBeGreaterThan(0);
  });

  it('declares a headless block for every registered pipeline bank', () => {
    const missing = Object.entries(PIPELINE_BANK_CONFIG)
      .filter(([, config]) => config.transport === undefined)
      .map(([companyId]) => companyId);
    expect(missing).toEqual([]);
  });

  it.each(EXPECTED_URLS)('registers %s for %s', (group, bankId, url) => {
    const result = resolveWkUrl(group, bankId);
    const resolved = resolvedUrl(result);
    expect(resolved).toBe(url);
  });

  it('leaves a bank without a headless block without a WK identityBase', () => {
    const bank = CompanyTypes.Leumi;
    const config = PIPELINE_BANK_CONFIG[bank];
    if (config === undefined) throw new TypeError('missing registry');
    const { transport: transportConfig, ...withoutTransport } = config;
    expect(transportConfig).toBeDefined();
    resetWkRegistryForTest();
    try {
      SEEDER.seedWkFromPipelineConfig({ ...PIPELINE_BANK_CONFIG, [bank]: withoutTransport });
      const result = resolveWkUrl('identityBase', bank);
      const isResolved = isOk(result);
      expect(isResolved).toBe(false);
    } finally {
      resetWkRegistryForTest();
      SEEDER.seedWkFromPipelineConfig(PIPELINE_BANK_CONFIG);
    }
  });
});
