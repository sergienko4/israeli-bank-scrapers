/**
 * Pepper scrape shape — customer + balance extractors.
 * Transactions helpers live in PepperShapeTxns.ts.
 */

import type {
  ApiBody,
  IExtractAccountsArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { Brand } from '../../../Types/Brand.js';

/** Account display number — branded for Rule #15. */
type AccountNumberDisplay = Brand<string, 'PepperAccountNumberDisplay'>;
/** Current account balance — branded for Rule #15. */
type AccountBalance = Brand<number, 'PepperAccountBalance'>;
/** Product-supported predicate — branded for Rule #15. */
type IsSupportedProduct = Brand<boolean, 'PepperIsSupportedProduct'>;
/** Discovered product count — branded for Rule #15. */
type DiscoveredProductCount = Brand<number, 'PepperDiscoveredProductCount'>;
/** Balance-absent predicate — branded for Rule #15. */
type IsBalanceAbsent = Brand<boolean, 'PepperIsBalanceAbsent'>;

/** Account ref emitted by extractAccounts. */
export interface IPepperAcct {
  readonly accountId: string;
  readonly accountNumber?: string;
  readonly accountCategory?: string | null;
}

interface ICustomerEntry {
  readonly customerId?: string;
  readonly accounts?: readonly IPepperAcct[];
}
interface ICustomerResp {
  readonly userDataV2?: {
    readonly getUserDataV2?: { readonly customerAndAccounts?: readonly ICustomerEntry[] };
  };
}
interface IBalanceResp {
  readonly accounts?: { readonly balance?: { readonly currentBalance?: number } };
}

/**
 * Account categories Pepper's OSH resolver can actually serve.
 *
 * <p>`oshTransactionsNew` is the CURRENT-ACCOUNT-only resolver — Pepper rejects
 * it with an HTTP 400 for any other product. Because the driver discards a
 * scrape when one account fails, a single foreign-currency or securities
 * product used to destroy the whole run (issue #550). Products outside this
 * list are therefore excluded at discovery and never requested at all.
 *
 * <p>Deliberately an ALLOW-list rather than a deny-list of the reported
 * `Foreign` / `SecuritiesAccount` values: `Ils` is the only category confirmed
 * against a live production account, so an unrecognised future category must
 * surface loudly instead of being silently dropped.
 */
export const PEPPER_SUPPORTED_ACCOUNT_CATEGORIES = ['Ils'] as const;

/**
 * Decide whether Pepper's OSH resolver can serve a product.
 *
 * <p>A product carrying NO usable `accountCategory` is treated as SUPPORTED.
 * Live payloads always carry the field, so its absence signals a schema change
 * — and attempting an account (failing loudly if the resolver rejects it) is
 * far safer than silently omitting one that holds real money.
 *
 * <p>"No usable category" means any NON-STRING value AND any blank string, not
 * just `undefined`: `accountCategory` is nullable in Pepper's schema and the
 * payload reaches this function through an unchecked cast, so a JSON `null` is
 * a routine wire value — and a blank string is a string syntactically but
 * carries no category semantically. Both mean UNKNOWN, never "unsupported".
 *
 * <p>Blankness is the ONLY normalisation applied. The allow-list comparison
 * itself stays exact, so a padded near-miss such as `' Ils '` remains an
 * ordinary unrecognised value and is excluded rather than silently promoted
 * into a supported category.
 * @param acct - Pepper account.
 * @returns True when the account should be scraped.
 */
export function isSupportedAccount(acct: IPepperAcct): IsSupportedProduct {
  const category = acct.accountCategory;
  if (typeof category !== 'string') return true as IsSupportedProduct;
  if (category.trim().length === 0) return true as IsSupportedProduct;
  const supported: readonly string[] = PEPPER_SUPPORTED_ACCOUNT_CATEGORIES;
  return supported.includes(category) as IsSupportedProduct;
}

/**
 * Flatten every product the customer payload declares, unfiltered.
 *
 * Pepper's customer endpoint carries the full account tree in the
 * response body, so this ignores the post-login session-context bundle field.
 * @param args - Extract-args bundle (uses `args.body` only).
 * @returns Every product across every customer, in payload order.
 */
function discoveredAccountsOf(args: IExtractAccountsArgs): readonly IPepperAcct[] {
  const resp = args.body as unknown as ICustomerResp;
  const customers = resp.userDataV2?.getUserDataV2?.customerAndAccounts ?? [];
  return customers.flatMap((c): readonly IPepperAcct[] => c.accounts ?? []);
}

/**
 * Flatten userDataV2 → customers → accounts, keeping only the products the
 * OSH transactions resolver can serve (see {@link isSupportedAccount}).
 * Signature matches the unified scrape-shape contract.
 * @param args - Extract-args bundle (uses `args.body` only).
 * @returns Flat list of scrapeable accounts.
 */
export function extractAccounts(args: IExtractAccountsArgs): readonly IPepperAcct[] {
  const discovered = discoveredAccountsOf(args);
  return discovered.filter(isSupportedAccount);
}

/**
 * How many products the profile held BEFORE the supported-category filter.
 *
 * <p>Wired as the shape's `countDiscovered` so the driver can report what was
 * excluded. Without it, dropping a product would be an invisible omission of
 * money — see issue #550.
 * @param args - Extract-args bundle (uses `args.body` only).
 * @returns Count of products the customer payload declared.
 */
export function countDiscovered(args: IExtractAccountsArgs): DiscoveredProductCount {
  const discovered = discoveredAccountsOf(args);
  return discovered.length as DiscoveredProductCount;
}

/**
 * accountNumberOf — falls back to accountId when accountNumber is absent.
 * @param acct - Pepper account.
 * @returns Display number.
 */
export function accountNumberOf(acct: IPepperAcct): AccountNumberDisplay {
  return (acct.accountNumber ?? acct.accountId) as AccountNumberDisplay;
}

/**
 * Declare a balance response that carries NO figure.
 *
 * <p>Consulted by the driver BEFORE {@link balanceExtract}, so a
 * successful-but-malformed payload is reported as unknown-and-degraded rather
 * than coerced to a real-looking zero. A genuine `0` balance is a number and
 * so is never treated as absent.
 * @param body - Unwrapped balance response.
 * @returns True when the response carries no numeric currentBalance.
 */
export function balanceIsAbsent(body: ApiBody): IsBalanceAbsent {
  const resp = body as unknown as IBalanceResp;
  const figure = resp.accounts?.balance?.currentBalance;
  return (typeof figure !== 'number') as IsBalanceAbsent;
}

/**
 * Balance extractor — reads the figure the response carries.
 *
 * <p>The `?? 0` is unreachable in the driver, which consults
 * {@link balanceIsAbsent} first; it stands only to keep the branded return
 * total for a direct caller.
 * @param body - Unwrapped balance response.
 * @returns Current balance.
 */
export function balanceExtract(body: ApiBody): AccountBalance {
  const resp = body as unknown as IBalanceResp;
  return (resp.accounts?.balance?.currentBalance ?? 0) as AccountBalance;
}

/**
 * Balance vars builder.
 * @param acct - Pepper account.
 * @returns Variables for fetchAccountBalance.
 */
export function balanceVars(acct: IPepperAcct): VarsMap {
  return { accountId: acct.accountId };
}

/**
 * Customer vars builder — UserDataV2 takes no variables.
 * @returns Empty variables map.
 */
export function customerVars(): VarsMap {
  return {};
}
