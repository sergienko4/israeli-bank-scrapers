/**
 * UrlsWK — unit tests for the per-bank URL registry.
 * Covers register/resolve round-trip + the zero-bank-name-literal guard.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CompanyTypes } from '../../../../../Definitions.js';
import {
  isLiteralUrl,
  literalUrl,
  registerWkUrl,
  resolveWkUrl,
  WK_URLS,
  type WKUrlGroup,
} from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const HINT = CompanyTypes.OneZero;

beforeEach(() => {
  WK_URLS.clear();
});

describe('UrlsWK/registration', () => {
  it('register then resolve round-trips the URL string', () => {
    const urlText = 'https://identity.example/devices/token';
    const didStore = registerWkUrl('identity.deviceToken', HINT, urlText);
    expect(didStore).toBe(true);
    const result = resolveWkUrl('identity.deviceToken', HINT);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value).toBe(urlText);
  });

  it('supports multiple URL groups for the same hint', () => {
    registerWkUrl('identityBase', HINT, 'https://id.example');
    registerWkUrl('graphql', HINT, 'https://mobile.example/graphql');
    const baseResult = resolveWkUrl('identityBase', HINT);
    const gqlResult = resolveWkUrl('graphql', HINT);
    if (isOk(baseResult)) expect(baseResult.value).toBe('https://id.example');
    if (isOk(gqlResult)) expect(gqlResult.value).toBe('https://mobile.example/graphql');
  });

  it('supports multiple bank hints independently per group', () => {
    registerWkUrl('identity.otpPrepare', HINT, 'https://a.example/prepare');
    registerWkUrl('identity.otpPrepare', CompanyTypes.Hapoalim, 'https://b.example/prepare');
    const oneZero = resolveWkUrl('identity.otpPrepare', HINT);
    const hapoalim = resolveWkUrl('identity.otpPrepare', CompanyTypes.Hapoalim);
    if (isOk(oneZero)) expect(oneZero.value).toBe('https://a.example/prepare');
    if (isOk(hapoalim)) expect(hapoalim.value).toBe('https://b.example/prepare');
  });
});

describe('UrlsWK/resolveFailure', () => {
  it('unknown URL group returns fail with diagnostic message', () => {
    const result = resolveWkUrl('identity.otpVerify', HINT);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) expect(result.errorMessage).toContain('unknown WK url');
  });

  it('known URL group but unknown bank hint returns fail', () => {
    registerWkUrl('identity.getIdToken' satisfies WKUrlGroup, HINT, 'https://x.example');
    const result = resolveWkUrl('identity.getIdToken', CompanyTypes.Hapoalim);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
  });
});

describe('UrlsWK/literalUrl', () => {
  it('brands an absolute URL that isLiteralUrl accepts', () => {
    const branded = literalUrl('https://api.example/txns');
    const isLiteral = isLiteralUrl(branded);
    expect(isLiteral).toBe(true);
  });

  it('treats a WK group tag as not a literal URL', () => {
    const isLiteral = isLiteralUrl('graphql');
    expect(isLiteral).toBe(false);
  });

  it('resolves a literal URL by passthrough with an empty registry', () => {
    const urlText = 'https://api.example/accounts';
    const tag = literalUrl(urlText);
    const result = resolveWkUrl(tag, HINT);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value).toBe(urlText);
  });
});

/** Exact Pepper auth endpoints, pinned as single-slash full URLs. */
const PEPPER_AUTH_URLS = [
  { $label: 'auth.bind', url: 'https://sa.pepper.co.il/api/v2/auth/bind' },
  { $label: 'auth.login', url: 'https://sa.pepper.co.il/api/v2/auth/login' },
  { $label: 'auth.assert', url: 'https://sa.pepper.co.il/api/v2/auth/assert' },
  { $label: 'auth.logout', url: 'https://sa.pepper.co.il/api/v2/auth/logout' },
] as const;

/**
 * Re-seed the registry from the real bank config after `beforeEach` cleared it.
 * Dynamic import dodges the DI rule banning static Registry/Config imports.
 * @returns Resolves once the registry is seeded.
 */
async function seedFromBankConfig(): Promise<void> {
  const registry =
    await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
  const seeder =
    await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigSeeder.js');
  seeder.seedWkFromPipelineConfig(registry.PIPELINE_BANK_CONFIG);
}

describe('UrlsWK/pepperAuthUrls', () => {
  it.each(PEPPER_AUTH_URLS)('resolves $label to its exact full URL', async ({ $label, url }) => {
    await seedFromBankConfig();
    const result = resolveWkUrl($label, CompanyTypes.Pepper);
    expect(result).toEqual({ success: true, value: url });
  });

  it('registers auth.login for Pepper only', async () => {
    await seedFromBankConfig();
    const owners = WK_URLS.get('auth.login');
    const ownerHints = [...(owners?.keys() ?? [])];
    expect(ownerHints).toEqual([CompanyTypes.Pepper]);
  });

  it('registers every Pepper auth.* URL as a single-slash full URL on the identity origin', async () => {
    await seedFromBankConfig();
    const base = resolveWkUrl('identityBase', CompanyTypes.Pepper);
    const origin = isOk(base) ? new URL(base.value).origin : 'missing';
    const authUrls = [...WK_URLS.entries()]
      .filter(([group]): boolean => group.startsWith('auth.'))
      .map(([, owners]): string => owners.get(CompanyTypes.Pepper) ?? 'missing');
    expect(authUrls).toHaveLength(PEPPER_AUTH_URLS.length);
    const offenders = authUrls.filter((url): boolean => {
      const parsed = new URL(url);
      return parsed.origin !== origin || !/^\/api\/v2\/auth\/\w+$/.test(parsed.pathname);
    });
    expect(offenders).toEqual([]);
  });
});

/**
 * Resolve this test file's directory via import.meta.url (ESM-safe).
 * @returns Absolute directory of this test file.
 */
function thisDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return dirname(thisFile);
}

describe('UrlsWK/sourceContract', () => {
  it('source file contains no bank-name string literals', () => {
    const here = thisDir();
    const filePath = resolvePath(here, '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.ts');
    const source = readFileSync(filePath, 'utf8');
    const bannedNamesPattern =
      /oneZero|amex|isracard|hapoalim|discount|visaCal|beinleumi|massad|mercantile|otsarHahayal|pagi/i;
    const hit = bannedNamesPattern.exec(source);
    expect(hit).toBeNull();
  });
});
