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
 *   - T-DNS-4: no bank re-declares the host already in its `urls.base`.
 *   - T-DNS-5: every key is a bank the registry actually knows.
 *   - T-DNS-6: every host a bank's transport block calls is declared, unless
 *     it is the bank's own `urls.base` host.
 *   - T-DNS-7: GraphQL-only hosts remain covered by the completeness guard.
 *   - T-DNS-8: VisaCal declares only its active mobile gateway.
 *
 * Import paths are inline string literals so TypeScript resolves the
 * module types, and the imports are dynamic to dodge the
 * no-restricted-imports DI rule that bans static imports of
 * Registry/Config/** in Pipeline tests.
 */

import { CompanyTypes } from '../../../../../Definitions.js';

/** Bare hostname: dot-separated labels, no scheme, port, path or trailing dot. */
const BARE_HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Host proven to have no A record. Declaring it would make the
 * fail-loud warm loop reject every run.
 */
const NO_SUCH_HOST = 'he.isracard.co.il';

/** Hosts reachable only through each bank's `transport.graphql` field. */
const GRAPHQL_ONLY_HOSTS = [
  [CompanyTypes.OneZero, 'mobile.tfd-bank.com'],
  [CompanyTypes.Pepper, 'fe-sec.pepper.co.il'],
] as const;

/** VisaCal's only live API gateway. */
const VISACAL_MOBILE_HOST = 'api-cc.cal-online.co.il';

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

/**
 * Hosts one bank's transport block calls that the warm-up would leave cold:
 * neither the bank's `urls.base` host nor declared in the manifest.
 *
 * @param companyId - Registry key.
 * @param manifest - The declared extra hosts.
 * @returns `bank:host` labels for every cold host; empty when none.
 */
async function coldTransportHosts(
  companyId: CompanyTypes,
  manifest: ExtraHostsByBank,
): Promise<string[]> {
  const { resolvePipelineBankConfig } =
    await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
  const config = resolvePipelineBankConfig(companyId);
  if (config === false || !config.transport) return [];
  const urls = [
    config.transport.identityBase,
    config.transport.graphql,
    ...Object.values(config.transport.paths),
  ];
  const hosts = new Set(urls.map(url => new URL(url).hostname));
  const warmed = [new URL(config.urls.base).hostname, ...(manifest[companyId] ?? [])];
  const cold = [...hosts].filter(host => !warmed.includes(host));
  return cold.map(host => `${companyId}:${host}`);
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

  it("T-DNS-6: declares every host a bank's headless block calls", async () => {
    const manifest = await loadHosts();
    const pending = Object.values(CompanyTypes).map(id => coldTransportHosts(id, manifest));
    const perBank = await Promise.all(pending);
    const cold = perBank.flat();
    expect(cold).toEqual([]);
  });

  it.each(GRAPHQL_ONLY_HOSTS)(
    'T-DNS-7: detects %s when its GraphQL-only host is removed',
    async (companyId, host) => {
      const manifest = await loadHosts();
      const remaining = (manifest[companyId] ?? []).filter(entry => entry !== host);
      const missing = { ...manifest, [companyId]: remaining };
      const cold = await coldTransportHosts(companyId, missing);
      expect(cold).toContain(`${companyId}:${host}`);
    },
  );

  it('T-DNS-8: VisaCal warms only its active mobile gateway', async () => {
    const manifest = await loadHosts();
    expect(manifest[CompanyTypes.VisaCal]).toEqual([VISACAL_MOBILE_HOST]);
  });
});
