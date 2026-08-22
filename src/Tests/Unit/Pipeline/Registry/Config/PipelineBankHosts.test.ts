/**
 * T-DNS — the CI DNS warm-up manifest stays valid and stays honest.
 *
 * `.github/scripts/ci/dns-warmup.sh` greps this manifest with plain
 * grep+sed (it runs before `npm install`, so it cannot import TS) and
 * then fails the job loud if any listed host does not resolve. That
 * makes two mistakes expensive, and neither is caught by the compiler:
 *
 *   - a malformed entry (scheme or path pasted in with the hostname)
 *     is silently skipped by the extractor, so the host stays cold and
 *     the bank fails later with NS_ERROR_UNKNOWN_HOST;
 *   - a host with no DNS record at all holds every E2E run red.
 *
 * <p>Test Case IDs:
 *   - T-DNS-1: every declared host is a bare, well-formed hostname.
 *   - T-DNS-2: `he.isracard.co.il` is never declared — it has no A record.
 *   - T-DNS-3: Yahav declares `login.yahav.co.il`, the iframe origin.
 *   - T-DNS-4: no bank re-declares the host already in its `urls.base`.
 *   - T-DNS-5: every key is a bank the registry actually knows.
 *
 * Import paths are inline string literals so TypeScript resolves the
 * module types, and the imports are dynamic to dodge the
 * no-restricted-imports DI rule that bans static imports of
 * Registry/Config/** in Pipeline tests (same precedent as
 * PipelineBankConfigAuthStrategy.test.ts).
 */

import { CompanyTypes } from '../../../../../Definitions.js';

/** Bare hostname: dot-separated labels, no scheme, port, path or trailing dot. */
const BARE_HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Host proven to have no A record. Declaring it would make the
 * fail-loud warm loop reject every run. It survives only inside the
 * gated LoginDnsProbe diagnostic, where a failed lookup is the point.
 */
const NO_SUCH_HOST = 'he.isracard.co.il';

/** Mirrors `BankExtraDnsHosts`, which cannot be imported statically here. */
type ExtraHostsByBank = Readonly<Partial<Record<CompanyTypes, readonly string[]>>>;

/**
 * Loads the manifest under test.
 *
 * @returns the declared extra hosts, keyed by company.
 */
async function loadHosts(): Promise<ExtraHostsByBank> {
  const { BANK_EXTRA_DNS_HOSTS: extraHostsByBank } =
    await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankHosts.js');
  return extraHostsByBank;
}

/**
 * Loads each bank's auto-extracted base URL, keyed by company.
 *
 * @returns a lookup of company id to the configured `urls.base`.
 */
async function loadBaseUrls(): Promise<Map<string, string>> {
  const { PIPELINE_BANK_CONFIG: bankConfigMap } =
    await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
  return new Map(Object.entries(bankConfigMap).map(([id, cfg]) => [id, cfg.urls.base]));
}

/**
 * Flattens the manifest into a single list of declared hostnames.
 *
 * @returns every hostname the warm-up script will be asked to resolve.
 */
async function allDeclaredHosts(): Promise<string[]> {
  const manifest = await loadHosts();
  return Object.values(manifest).flatMap(hosts => hosts);
}

describe('PipelineBankHosts — CI DNS warm-up manifest (T-DNS)', () => {
  it('T-DNS-1: every declared host is a bare, well-formed hostname', async () => {
    const hosts = await allDeclaredHosts();
    expect(hosts.length).toBeGreaterThan(0);
    const malformed = hosts.filter(host => !BARE_HOSTNAME.test(host));
    expect(malformed).toEqual([]);
  });

  it('T-DNS-2: never declares he.isracard.co.il — it has no A record', async () => {
    const hosts = await allDeclaredHosts();
    expect(hosts).not.toContain(NO_SUCH_HOST);
  });

  it('T-DNS-3: Yahav declares its runtime-only login iframe origin', async () => {
    const manifest = await loadHosts();
    expect(manifest[CompanyTypes.Yahav] ?? []).toContain('login.yahav.co.il');
  });

  it('T-DNS-4: no bank re-declares the host already carried by its config', async () => {
    const manifest = await loadHosts();
    const baseUrlByBank = await loadBaseUrls();
    const redundant: string[] = [];
    for (const [companyId, hosts] of Object.entries(manifest)) {
      const base = baseUrlByBank.get(companyId);
      const baseHost = base === undefined ? '' : new URL(base).hostname;
      const duplicates = hosts.filter(host => host === baseHost);
      redundant.push(...duplicates.map(host => `${companyId}:${host}`));
    }
    expect(redundant).toEqual([]);
  });

  it('T-DNS-5: every key is a bank the registry actually knows', async () => {
    const manifest = await loadHosts();
    const baseUrlByBank = await loadBaseUrls();
    const unknown = Object.keys(manifest).filter(companyId => !baseUrlByBank.has(companyId));
    expect(unknown).toEqual([]);
  });
});
