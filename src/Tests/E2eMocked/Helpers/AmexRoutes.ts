import { loadFixture } from './RequestInterceptor';

interface IAmexRouteOverrides {
  validate?: string;
  login?: string;
  accounts?: string;
  transactions?: string;
}

/**
 * Builds the default Amex mock route array with optional per-endpoint overrides.
 *
 * @param overrides - optional body overrides for validate, login, accounts, or transactions
 * @returns array of IMockRoute objects for use with setupRequestInterception
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
