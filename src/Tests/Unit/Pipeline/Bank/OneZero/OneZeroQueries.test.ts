/**
 * Unit tests for OneZero GraphQL query registration (WK side-effect imports).
 * After the OneZeroQueries module loads, the WK registry must resolve
 * non-empty query strings for (customer|transactions|balance) + OneZero.
 */

import '../../../../../Scrapers/Pipeline/Banks/OneZero/graphql/OneZeroQueries.js';

import { CompanyTypes } from '../../../../../Definitions.js';
import { resolveWkQuery } from '../../../../../Scrapers/Pipeline/Registry/WK/QueriesWK.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';

describe('OneZeroQueries — WK registration', () => {
  it('customer query resolves to a non-empty string', () => {
    const result = resolveWkQuery('customer', CompanyTypes.OneZero);
    assertOk(result);
    expect(result.value.length).toBeGreaterThan(0);
  });

  it('transactions query resolves to a non-empty string', () => {
    const result = resolveWkQuery('transactions', CompanyTypes.OneZero);
    assertOk(result);
    expect(result.value.length).toBeGreaterThan(0);
  });

  it('balance query resolves to a non-empty string', () => {
    const result = resolveWkQuery('balance', CompanyTypes.OneZero);
    assertOk(result);
    expect(result.value.length).toBeGreaterThan(0);
  });

  it('customer query contains the GetCustomer operation name', () => {
    const result = resolveWkQuery('customer', CompanyTypes.OneZero);
    assertOk(result);
    expect(result.value).toMatch(/GetCustomer/);
  });

  it('transactions query contains the GetMovements operation name', () => {
    const result = resolveWkQuery('transactions', CompanyTypes.OneZero);
    assertOk(result);
    expect(result.value).toMatch(/GetMovements/);
  });

  it('balance query contains the GetAccountBalance operation name', () => {
    const result = resolveWkQuery('balance', CompanyTypes.OneZero);
    assertOk(result);
    expect(result.value).toMatch(/GetAccountBalance/);
  });
});
