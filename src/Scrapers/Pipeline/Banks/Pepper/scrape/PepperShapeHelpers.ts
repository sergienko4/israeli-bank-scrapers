/**
 * Pepper scrape shape — customer + balance extractors.
 * Transactions helpers live in PepperShapeTxns.ts.
 */

import type { ApiBody, VarsMap } from '../../_Shared/HeadlessScrapeShape.js';

/** Display account number used in scraped output (falls back to accountId). */
type AccountNumberDisplay = string;
/** Current balance amount (0 when absent). */
type AccountBalance = number;

/** Account ref emitted by extractAccounts. */
export interface IPepperAcct {
  readonly accountId: string;
  readonly accountNumber?: string;
  readonly accountCategory?: string;
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
 * Flatten userDataV2 → customers → accounts.
 * @param body - Unwrapped UserDataV2 response.
 * @returns Flat account list.
 */
export function extractAccounts(body: ApiBody): readonly IPepperAcct[] {
  const resp = body as unknown as ICustomerResp;
  const customers = resp.userDataV2?.getUserDataV2?.customerAndAccounts ?? [];
  return customers.flatMap((c): readonly IPepperAcct[] => c.accounts ?? []);
}

/**
 * accountNumberOf — falls back to accountId when accountNumber is absent.
 * @param acct - Pepper account.
 * @returns Display number.
 */
export function accountNumberOf(acct: IPepperAcct): AccountNumberDisplay {
  return acct.accountNumber ?? acct.accountId;
}

/**
 * Balance extractor — currentBalance falls back to 0 when absent.
 * @param body - Unwrapped balance response.
 * @returns Current balance.
 */
export function balanceExtract(body: ApiBody): AccountBalance {
  const resp = body as unknown as IBalanceResp;
  return resp.accounts?.balance?.currentBalance ?? 0;
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
