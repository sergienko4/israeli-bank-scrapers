/**
 * UrlsWK — unit tests for the per-bank URL registry.
 * Covers register/resolve round-trip + the zero-bank-name-literal guard.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CompanyTypes } from '../../../../../Definitions.js';
import type { IApiDirectRuleInput } from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import {
  isLiteralUrl,
  literalUrl,
  registerWkUrl,
  resetWkRegistryForTest,
  resolveWkUrl,
  type WKUrlGroup,
} from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const HINT = CompanyTypes.OneZero;
const PEPPER = CompanyTypes.Pepper;

/** Every `auth.*` group tag in `WKUrlGroup`, used to audit per-bank auth ownership. */
const ALL_AUTH_GROUPS: readonly WKUrlGroup[] = [
  'auth.bind',
  'auth.login',
  'auth.assert',
  'auth.logout',
  'auth.prime',
  'auth.resume',
  'auth.service',
  'auth.bootstrap',
  'auth.landing',
  'auth.logon',
  'auth.encryptionKey',
  'auth.identify',
  'auth.verify',
  'auth.otpInit',
  'auth.otpVerify',
];

beforeEach(() => {
  resetWkRegistryForTest();
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

/** Exact VisaCal auth endpoints on the CAL login gateway. */
const CAL_AUTH_URLS = [
  {
    $label: 'auth.login',
    url: 'https://api-cc.cal-online.co.il/Authentication/api/login/regularLogin',
  },
  {
    $label: 'auth.resume',
    url: 'https://api-cc.cal-online.co.il/Authentication/api/login/bioLogin',
  },
] as const;

/** Exact Max auth endpoints on the max.co.il origin. */
const MAX_AUTH_URLS = [
  { $label: 'auth.prime', url: 'https://www.max.co.il/api/registered/clientcontext' },
  { $label: 'auth.login', url: 'https://www.max.co.il/api/login/login' },
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

  it('shares auth.login between exactly Pepper, VisaCal, Max, Mizrahi, Beinleumi, Massad, OtsarHahayal, Pagi and Leumi', async () => {
    await seedFromBankConfig();
    const ownerHints = new Set(
      Object.values(CompanyTypes).filter((bank): boolean => {
        const outcome = resolveWkUrl('auth.login', bank);
        return isOk(outcome);
      }),
    );
    const expected = new Set([
      CompanyTypes.Pepper,
      CompanyTypes.VisaCal,
      CompanyTypes.Max,
      CompanyTypes.Mizrahi,
      CompanyTypes.Beinleumi,
      CompanyTypes.Massad,
      CompanyTypes.OtsarHahayal,
      CompanyTypes.Pagi,
      CompanyTypes.Leumi,
    ]);
    expect(ownerHints).toEqual(expected);
  });

  it('registers every Pepper auth.* URL as a single-slash full URL on the identity origin', async () => {
    await seedFromBankConfig();
    const base = resolveWkUrl('identityBase', CompanyTypes.Pepper);
    const origin = isOk(base) ? new URL(base.value).origin : 'missing';
    const authUrls = ALL_AUTH_GROUPS.flatMap((group): string[] => {
      const resolved = resolveWkUrl(group, PEPPER);
      return isOk(resolved) ? [resolved.value] : [];
    });
    expect(authUrls).toHaveLength(PEPPER_AUTH_URLS.length);
    const offenders = authUrls.filter((url): boolean => {
      const parsed = new URL(url);
      return parsed.origin !== origin || !/^\/api\/v2\/auth\/\w+$/.test(parsed.pathname);
    });
    expect(offenders).toEqual([]);
  });
});

/** Each ring issuer's one login endpoint; each step names its service in the query. */
const RING_SERVICES = [
  { bank: CompanyTypes.Isracard, url: 'https://ring.isracard.co.il/service' },
  { bank: CompanyTypes.Amex, url: 'https://ring.americanexpress.co.il/service' },
] as const;

describe('UrlsWK/ringAuthUrls', () => {
  it.each(RING_SERVICES)(
    'resolves $bank auth.service to its exact ring URL',
    async ({ bank, url }) => {
      await seedFromBankConfig();
      const result = resolveWkUrl('auth.service', bank);
      expect(result).toEqual({ success: true, value: url });
    },
  );
});

describe('UrlsWK/calAuthUrls', () => {
  it.each(CAL_AUTH_URLS)('resolves $label to its exact full URL', async ({ $label, url }) => {
    await seedFromBankConfig();
    const result = resolveWkUrl($label, CompanyTypes.VisaCal);
    expect(result).toEqual({ success: true, value: url });
  });
});

describe('UrlsWK/maxAuthUrls', () => {
  it.each(MAX_AUTH_URLS)('resolves $label to its exact full URL', async ({ $label, url }) => {
    await seedFromBankConfig();
    const result = resolveWkUrl($label, CompanyTypes.Max);
    expect(result).toEqual({ success: true, value: url });
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

/** A bank's headless block as the seeder reads it. */
type HeadlessBlock = Exclude<IApiDirectRuleInput['transport'], false>;

const SESSION_ORIGIN = 'https://session.example';
const BOOTSTRAP_URL = `${SESSION_ORIGIN}/bootstrap`;
const LANDING_URL = `${SESSION_ORIGIN}/landing`;
const LOGON_URL = `${SESSION_ORIGIN}/logon`;
const ENCRYPTION_KEY_URL = `${SESSION_ORIGIN}/encryption-key`;
const IDENTIFY_URL = `${SESSION_ORIGIN}/identify`;
const VERIFY_URL = `${SESSION_ORIGIN}/verify`;
const OTP_INIT_URL = `${SESSION_ORIGIN}/otp-init`;
const OTP_VERIFY_URL = `${SESSION_ORIGIN}/otp-verify`;

/** Every session-transport auth path a headless block can name. */
const SESSION_PATHS: HeadlessBlock['paths'] = {
  'auth.bootstrap': BOOTSTRAP_URL,
  'auth.landing': LANDING_URL,
  'auth.logon': LOGON_URL,
  'auth.encryptionKey': ENCRYPTION_KEY_URL,
  'auth.identify': IDENTIFY_URL,
  'auth.verify': VERIFY_URL,
  'auth.otpInit': OTP_INIT_URL,
  'auth.otpVerify': OTP_VERIFY_URL,
};

/** The WK tag each session path seeds. */
const SESSION_TAGS = [
  { $label: 'auth.bootstrap', url: BOOTSTRAP_URL },
  { $label: 'auth.landing', url: LANDING_URL },
  { $label: 'auth.logon', url: LOGON_URL },
  { $label: 'auth.encryptionKey', url: ENCRYPTION_KEY_URL },
  { $label: 'auth.identify', url: IDENTIFY_URL },
  { $label: 'auth.verify', url: VERIFY_URL },
  { $label: 'auth.otpInit', url: OTP_INIT_URL },
  { $label: 'auth.otpVerify', url: OTP_VERIFY_URL },
] as const;

/**
 * Seed one synthetic api-direct bank whose headless block names every
 * session-transport path. Dynamic import dodges the DI rule.
 * @returns Resolves once the registry is seeded.
 */
async function seedSessionBank(): Promise<void> {
  const seeder =
    await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigSeeder.js');
  const graphql = `${SESSION_ORIGIN}/graphql`;
  const headless: HeadlessBlock = { identityBase: SESSION_ORIGIN, graphql, paths: SESSION_PATHS };
  const config = { urls: { base: SESSION_ORIGIN }, transport: headless } as const;
  seeder.seedWkFromPipelineConfig({ [HINT]: config });
}

describe('UrlsWK/sessionAuthTags', () => {
  it.each(SESSION_TAGS)('seeds $label from a headless block', async ({ $label, url }) => {
    await seedSessionBank();
    const result = resolveWkUrl($label, HINT);
    expect(result).toEqual({ success: true, value: url });
  });
});

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

describe('UrlsWK/freezeOnFirstRead', () => {
  it('fails closed when registerWkUrl is called after resolveWkUrl', () => {
    registerWkUrl('identityBase', HINT, 'https://id.example');
    resolveWkUrl('identityBase', HINT);
    expect(() => {
      registerWkUrl('graphql', HINT, 'https://gql.example');
    }).toThrow(/WK URL registry is frozen/);
  });

  it('freezes even when the first resolveWkUrl uses a literalUrl passthrough', () => {
    const inlineTag = literalUrl('https://api.example/direct');
    resolveWkUrl(inlineTag, HINT);
    expect(() => {
      registerWkUrl('identityBase', HINT, 'https://id.example');
    }).toThrow(/WK URL registry is frozen/);
  });

  it('allows registration again after resetWkRegistryForTest', () => {
    resolveWkUrl('identityBase', HINT);
    resetWkRegistryForTest();
    registerWkUrl('identityBase', HINT, 'https://id-reset.example');
    const result = resolveWkUrl('identityBase', HINT);
    expect(result).toEqual({ success: true, value: 'https://id-reset.example' });
  });
});
