import { loadFixture } from './RequestInterceptor.js';

interface IAmexRouteOverrides {
  validate?: string;
  login?: string;
  accounts?: string;
  transactions?: string;
}

/**
 * Build a set of Amex mock routes for e2e tests.
 * @param overrides - Optional JSON body overrides per endpoint.
 * @returns Array of mock route definitions.
 */
export default function amexRoutes(
  overrides: IAmexRouteOverrides = {},
): { match: string; method?: 'POST'; contentType: string; body: string }[] {
  return [
    {
      match: '/personalarea/Login',
      contentType: 'text/html',
      body: loadFixture('amex/login-page.html'),
    },
    {
      match: 'reqName=ValidateIdData',
      method: 'POST' as const,
      contentType: 'application/json',
      body: overrides.validate ?? loadFixture('amex/validate-success.json'),
    },
    {
      match: 'reqName=performLogonI',
      method: 'POST' as const,
      contentType: 'application/json',
      body: overrides.login ?? loadFixture('amex/login-success.json'),
    },
    {
      match: 'reqName=DashboardMonth',
      contentType: 'application/json',
      body: overrides.accounts ?? loadFixture('amex/accounts-response.json'),
    },
    {
      match: 'reqName=CardsTransactionsList',
      contentType: 'application/json',
      body: overrides.transactions ?? loadFixture('amex/transactions-response.json'),
    },
  ];
}
