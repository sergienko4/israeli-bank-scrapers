/**
 * PiiRedactor / RoutingBankKeys — bank response keys the generic
 * camelCase table in `Routing.ts` does not cover.
 *
 * Mizrahi's SkyBL responses (logon, changeAccount, balance, get428Index)
 * name owner identity, account numbers, balances, credit lines,
 * transaction text and transaction references in PascalCase and
 * transliterated Hebrew. Without
 * these entries `classifyKey` returns `unknown` and `redactJsonBody`
 * writes the raw values into dumps and traces. Spread into
 * `PATH_TAIL_TO_CATEGORY`; kept apart so the table stays under the
 * file-size cap.
 */

import type { PiiCategory } from './Types.js';

/** Mizrahi SkyBL path-tail key → PiiCategory. */
const BANK_PATH_TAIL_TO_CATEGORY: Readonly<Partial<Record<string, PiiCategory>>> = {
  Number: 'account',
  AccountNumber: 'account',
  SnifAndNumber: 'account',
  SnifAndNumber400: 'account',
  NegdiCheshbon: 'account',
  /** Permission names embed the account number (`AC_<account>_…`). */
  Role: 'account',
  /** Balance reply echoes its request, account number included. */
  ret_input: 'account',
  Name: 'name',
  Details: 'name',
  AccountName: 'name',
  BankerName: 'name',
  NegdiShem: 'name',
  Teur: 'merchant',
  MC02TnuaTeurEZ: 'merchant',
  Yitra: 'amount',
  YitraLeloChekim: 'amount',
  YitraAdkanit: 'amount',
  YitraAdkanitLeloChekim: 'amount',
  YitraPahak: 'amount',
  Remain: 'amount',
  Ashrai: 'amount',
  MC02SchumEZ: 'amount',
  MC02YitraEZ: 'amount',
  MC04Schum1EZ: 'amount',
  MC04Schum2EZ: 'amount',
  MC04Schum3EZ: 'amount',
  itra: 'amount',
  itraLelo_shekim: 'amount',
  misgeret: 'amount',
  misgeret_kolel: 'amount',
  misgeret_zmani: 'amount',
  schum1: 'amount',
  schum2: 'amount',
  schum3: 'amount',
  UserId: 'token',
  anonymousID: 'token',
  ClientGWIdentifier: 'token',
  actionGUID: 'token',
  /** Transaction reference numbers, opaque IDs like the ones above. */
  MC02AsmEZ: 'token',
  MC02AsmahtaMekoritEZ: 'token',
};

export default BANK_PATH_TAIL_TO_CATEGORY;
