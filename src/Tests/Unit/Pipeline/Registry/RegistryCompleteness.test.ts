/**
 * Registry completeness — every bank the public enum exposes must be
 * registered everywhere the pipeline enumerates banks.
 *
 * <p>`BANK_EXTRA_DNS_HOSTS` is deliberately partial: banks whose whole flow
 * lives on their marketing apex have no extra host to warm, so it is checked
 * only for stray keys, not for full coverage.
 */

import { CompanyTypes, SCRAPERS } from '../../../../Definitions.js';

const { default: PIPELINE_REGISTRY } =
  await import('../../../../Scrapers/Pipeline/Banks/PipelineRegistry.js');
const REGISTRY =
  await import('../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
const { BANK_EXTRA_DNS_HOSTS } =
  await import('../../../../Scrapers/Pipeline/Registry/Config/PipelineBankHosts.js');
const { isKnownBankSlug: IS_KNOWN_BANK_SLUG } =
  await import('../../../../Scrapers/Pipeline/Types/BankSlugs.js');

/** Every member of the public bank enum. */
const BANKS: readonly CompanyTypes[] = Object.values(CompanyTypes);

/**
 * Missing keys of a partial record.
 * @param registry - Registry keyed by bank.
 * @returns Banks without an own entry, sorted.
 */
function missingFrom(
  registry: Readonly<Partial<Record<CompanyTypes, unknown>>>,
): readonly string[] {
  return BANKS.filter((bank): boolean => !Object.hasOwn(registry, bank)).sort();
}

describe('pipeline bank registry completeness', () => {
  it('registers every bank in SCRAPERS', () => {
    const missing = BANKS.filter((bank): boolean => !Object.hasOwn(SCRAPERS, bank));
    expect(missing).toStrictEqual([]);
  });

  it('registers every bank in PIPELINE_REGISTRY', () => {
    const missing = missingFrom(PIPELINE_REGISTRY);
    expect(missing).toStrictEqual([]);
  });

  it('resolves a pipeline bank config for every bank', () => {
    const missing = BANKS.filter(
      (bank): boolean => REGISTRY.resolvePipelineBankConfig(bank) === false,
    ).sort();
    expect(missing).toStrictEqual([]);
  });

  it('knows every lowercase bank slug', () => {
    const missing = BANKS.map((bank): string => bank.toLowerCase()).filter(
      (slug): boolean => !IS_KNOWN_BANK_SLUG(slug),
    );
    expect(missing).toStrictEqual([]);
  });

  it('has no duplicate registry entries across the four table shards', async () => {
    const shards = await Promise.all([
      import('../../../../Scrapers/Pipeline/Banks/BankPipelineTableA.js'),
      import('../../../../Scrapers/Pipeline/Banks/BankPipelineTableB.js'),
      import('../../../../Scrapers/Pipeline/Banks/BankPipelineTableC.js'),
      import('../../../../Scrapers/Pipeline/Banks/BankPipelineTableD.js'),
    ]);
    const keys = shards.flatMap(shard => Object.keys(shard.default));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has no unknown keys in the partial DNS-host map', () => {
    const banks = new Set<string>(BANKS);
    const unknown = Object.keys(BANK_EXTRA_DNS_HOSTS).filter((bank): boolean => !banks.has(bank));
    expect(unknown).toStrictEqual([]);
  });
});
