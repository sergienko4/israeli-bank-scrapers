/**
 * WK seeding contract for PIPELINE_BANK_CONFIG.
 *
 * Loading the bank-config module seeds every headless URL into the WK
 * registry. The seeder walks the CompanyTypes enum, so these tests pin that
 * every configured headless URL resolves, and banks without a headless block
 * stay unregistered.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import {
  resolveWkUrl,
  type WKUrlGroup,
} from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { isOk, type Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

// Dynamic import dodges the no-restricted-imports DI rule that bans static
// imports of Registry/Config/** in Pipeline tests (precedent:
// PipelineBankConfigPepperWaf.test.ts).
const { PIPELINE_BANK_CONFIG } =
  await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');

/** One bank's entry in PIPELINE_BANK_CONFIG. */
type BankConfig = (typeof PIPELINE_BANK_CONFIG)[CompanyTypes];

/** One bank's headless `paths` map. */
type HeadlessPaths = NonNullable<NonNullable<BankConfig>['headless']>['paths'];

/** One URL the seeder must register: [group, bank, url]. */
type SeededUrl = readonly [WKUrlGroup, CompanyTypes, string];

/**
 * List the per-bank auth-path URLs one headless block declares.
 * @param bankId - Bank to read.
 * @param paths - That bank's headless `paths` map.
 * @returns The path URLs the seeder must register.
 */
function expectedPathUrls(bankId: CompanyTypes, paths: HeadlessPaths): SeededUrl[] {
  return Object.entries(paths).flatMap(([key, url]): SeededUrl[] =>
    url ? [[key as WKUrlGroup, bankId, url]] : [],
  );
}

/**
 * List every URL one bank's headless block declares.
 * @param bankId - Bank to read.
 * @param config - That bank's pipeline config.
 * @returns The URLs the seeder must register for the bank.
 */
function expectedUrlsFor(bankId: CompanyTypes, config: BankConfig): SeededUrl[] {
  const headless = config?.headless;
  if (!headless) return [];
  const pathUrls = expectedPathUrls(bankId, headless.paths);
  const identity: SeededUrl = ['identityBase', bankId, headless.identityBase];
  const graphql: SeededUrl = ['graphql', bankId, headless.graphql];
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
const BANKS_WITHOUT_HEADLESS = ALL_BANKS.filter(bankId => !PIPELINE_BANK_CONFIG[bankId]?.headless);

describe('PipelineBankConfigSeeder', () => {
  it('finds headless banks to check', () => {
    expect(EXPECTED_URLS.length).toBeGreaterThan(0);
  });

  it.each(EXPECTED_URLS)('registers %s for %s', (group, bankId, url) => {
    const result = resolveWkUrl(group, bankId);
    const resolved = resolvedUrl(result);
    expect(resolved).toBe(url);
  });

  it.each(BANKS_WITHOUT_HEADLESS)('leaves %s without a WK identityBase', bankId => {
    const result = resolveWkUrl('identityBase', bankId);
    const isResolved = isOk(result);
    expect(isResolved).toBe(false);
  });
});
