/**
 * QueriesWK — unit tests for the per-bank GraphQL query registry.
 * Covers register/resolve round-trip + the zero-bank-name-literal guard.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { jest } from '@jest/globals';

import { CompanyTypes } from '../../../../../Definitions.js';
import type * as QueriesWKModule from '../../../../../Scrapers/Pipeline/Registry/WK/QueriesWK.js';
import type { WKQueryOperation } from '../../../../../Scrapers/Pipeline/Registry/WK/QueriesWK.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

type QueriesModule = typeof QueriesWKModule;

const MODULE_PATH = '../../../../../Scrapers/Pipeline/Registry/WK/QueriesWK.js';
const HINT = CompanyTypes.OneZero;

let wk: QueriesModule;

beforeEach(async () => {
  jest.resetModules();
  wk = (await import(MODULE_PATH)) as QueriesModule;
});

describe('QueriesWK/registration', () => {
  it('register then resolve round-trips the query string', () => {
    const queryText = 'query GetCustomer { me { id } }';
    const didStore = wk.registerWkQuery('customer', HINT, queryText);
    expect(didStore).toBe(true);
    const result = wk.resolveWkQuery('customer', HINT);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    if (isOk(result)) expect(result.value).toBe(queryText);
  });

  it('supports multiple operations independently', () => {
    wk.registerWkQuery('customer', HINT, 'Q1');
    wk.registerWkQuery('transactions', HINT, 'Q2');
    const customerResult = wk.resolveWkQuery('customer', HINT);
    const txResult = wk.resolveWkQuery('transactions', HINT);
    if (isOk(customerResult)) expect(customerResult.value).toBe('Q1');
    if (isOk(txResult)) expect(txResult.value).toBe('Q2');
  });

  it('supports multiple bank hints independently per operation', () => {
    wk.registerWkQuery('balance', HINT, 'BalQuery');
    wk.registerWkQuery('balance', CompanyTypes.Hapoalim, 'BalHapoalim');
    const oneZero = wk.resolveWkQuery('balance', HINT);
    const hapoalim = wk.resolveWkQuery('balance', CompanyTypes.Hapoalim);
    if (isOk(oneZero)) expect(oneZero.value).toBe('BalQuery');
    if (isOk(hapoalim)) expect(hapoalim.value).toBe('BalHapoalim');
  });
});

describe('QueriesWK/resolveFailure', () => {
  it('unknown operation returns fail with diagnostic message', () => {
    const result = wk.resolveWkQuery('customer', HINT);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(false);
    if (!isOk(result)) expect(result.errorMessage).toContain('unknown WK query');
  });

  it('known operation but unknown bank hint returns fail', () => {
    wk.registerWkQuery('customer' satisfies WKQueryOperation, HINT, 'Q');
    const result = wk.resolveWkQuery('customer', CompanyTypes.Hapoalim);
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

describe('QueriesWK/freezeOnFirstRead', () => {
  it('fails closed when registerWkQuery is called after resolveWkQuery', () => {
    wk.registerWkQuery('customer', HINT, 'query Customer { me { id } }');
    wk.resolveWkQuery('customer', HINT);
    expect(() => {
      wk.registerWkQuery('balance', HINT, 'query Balance { balance }');
    }).toThrow(/WK query registry is frozen/);
  });

  it('starts unfrozen in a fresh module instance', async () => {
    wk.resolveWkQuery('customer', HINT);
    jest.resetModules();
    const fresh = (await import(MODULE_PATH)) as QueriesModule;
    fresh.registerWkQuery('customer', HINT, 'query Reset { me { id } }');
    const result = fresh.resolveWkQuery('customer', HINT);
    expect(result).toEqual({ success: true, value: 'query Reset { me { id } }' });
  });
});
