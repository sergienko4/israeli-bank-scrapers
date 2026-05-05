/**
 * QueriesWK — unit tests for the per-bank GraphQL query registry.
 * Covers register/resolve round-trip + the zero-bank-name-literal guard.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CompanyTypes } from '../../../../../Definitions.js';
import {
  registerWkQuery,
  resolveWkQuery,
  WK_QUERIES,
  type WKQueryOperation,
} from '../../../../../Scrapers/Pipeline/Registry/WK/QueriesWK.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const HINT = CompanyTypes.OneZero;

beforeEach(() => {
  WK_QUERIES.clear();
});

describe('QueriesWK/registration', () => {
  it('register then resolve round-trips the query string', () => {
    const queryText = 'query GetCustomer { me { id } }';
    const didStore = registerWkQuery('customer', HINT, queryText);
    expect(didStore).toBe(true);
    const result = resolveWkQuery('customer', HINT);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value).toBe(queryText);
  });

  it('supports multiple operations independently', () => {
    registerWkQuery('customer', HINT, 'Q1');
    registerWkQuery('transactions', HINT, 'Q2');
    const customerResult = resolveWkQuery('customer', HINT);
    const txResult = resolveWkQuery('transactions', HINT);
    if (isOk(customerResult)) expect(customerResult.value).toBe('Q1');
    if (isOk(txResult)) expect(txResult.value).toBe('Q2');
  });

  it('supports multiple bank hints independently per operation', () => {
    registerWkQuery('balance', HINT, 'BalQuery');
    registerWkQuery('balance', CompanyTypes.Hapoalim, 'BalHapoalim');
    const oneZero = resolveWkQuery('balance', HINT);
    const hapoalim = resolveWkQuery('balance', CompanyTypes.Hapoalim);
    if (isOk(oneZero)) expect(oneZero.value).toBe('BalQuery');
    if (isOk(hapoalim)) expect(hapoalim.value).toBe('BalHapoalim');
  });
});

describe('QueriesWK/resolveFailure', () => {
  it('unknown operation returns fail with diagnostic message', () => {
    const result = resolveWkQuery('customer', HINT);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) expect(result.errorMessage).toContain('unknown WK query');
  });

  it('known operation but unknown bank hint returns fail', () => {
    registerWkQuery('customer' satisfies WKQueryOperation, HINT, 'Q');
    const result = resolveWkQuery('customer', CompanyTypes.Hapoalim);
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

describe('QueriesWK/sourceContract', () => {
  it('source file contains no bank-name string literals', () => {
    const here = thisDir();
    const filePath = resolvePath(here, '../../../../../Scrapers/Pipeline/Registry/WK/QueriesWK.ts');
    const source = readFileSync(filePath, 'utf8');
    const bannedNamesPattern =
      /oneZero|amex|isracard|hapoalim|discount|visaCal|beinleumi|massad|mercantile|otsarHahayal|pagi/i;
    const hit = bannedNamesPattern.exec(source);
    expect(hit).toBeNull();
  });
});
