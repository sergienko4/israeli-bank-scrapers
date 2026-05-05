/**
 * UrlsWK — unit tests for the per-bank URL registry.
 * Covers register/resolve round-trip + the zero-bank-name-literal guard.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CompanyTypes } from '../../../../../Definitions.js';
import {
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
