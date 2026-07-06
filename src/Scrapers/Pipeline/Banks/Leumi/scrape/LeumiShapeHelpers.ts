/**
 * Leumi scrape shape — account list + balance extractors. The accounts
 * call is `UC_SO_GetAccounts` (returns `AccountsItems[]`); the balance
 * rides the shared `UC_SO_27` builder with the empty-range variant and
 * reads `BalanceDisplay` off the same response the transactions step
 * parses. Transactions helpers live in `LeumiShapeTxns.ts`.
 *
 * Grounded in the committed Leumi response fixtures (`responses/
 * accounts.json`, `responses/business-account-trx.json`). Raw History
 * rows normalise downstream via the field-mapping Data Mapper — never
 * in the shape.
 */

import type {
  ApiBody,
  IExtractAccountsArgs,
  VarsMap,
} from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { Brand } from '../../../Types/Brand.js';
import type { IActionContext } from '../../../Types/PipelineContext.js';
import { parseJsonResp, sessionHeader, wcfEnvelope } from './LeumiShapeEnvelope.js';
import { type IUcSo27Variant, ucSo27Vars } from './LeumiShapeUcSo27.js';

/** WCF module that returns the account list. */
export const GET_ACCOUNTS_MODULE = 'UC_SO_GetAccounts';

/** Account display number — branded for Rule #15. */
type AccountNumberDisplay = Brand<string, 'LeumiAccountNumberDisplay'>;
/** Current account balance — branded for Rule #15. */
type AccountBalance = Brand<number, 'LeumiAccountBalance'>;

/**
 * Leumi account reference. `accountIndex` (AccountsItems[].AccountIndex)
 * is the numeric id every UC_SO_27 request targets; `displayNumber`
 * (MaskedNumber) is the user-facing account number.
 */
export interface ILeumiAcct {
  readonly accountIndex: number;
  readonly displayNumber: string;
}

interface ILeumiAccountItem {
  readonly AccountIndex?: number;
  readonly MaskedNumber?: string;
}
interface IAccountsResp {
  readonly AccountsItems?: readonly ILeumiAccountItem[];
}
interface IBalanceResp {
  readonly BalanceDisplay?: number;
}

/** Account types the SPA requests — the WCF CSV field, verbatim. */
const LEUMI_ACCOUNT_TYPES =
  'CHECKING,FOREIGNACCOUNT,FOREIGNCD,FOREIGNLOAN,SECURITIES,PROVIDENTANDSTUDYFUNDS,SAVING,' +
  'MORTGAGE,CREDITCARD,CD,LOAN,OTHERCREDITCARD,CASHCARD,DEBITCARD';

/** Empty-range balance variant — no dates, PeriodType '0'. */
const BALANCE_VARIANT: IUcSo27Variant = {
  requestType: '',
  fromDateUtc: '',
  toDateUtc: '',
  periodType: '0',
};

/**
 * Build the `UC_SO_GetAccounts` inner request.
 * @param ctx - Action context (SessionHeader source).
 * @returns GetAccounts inner request object.
 */
function getAccountsInner(ctx: IActionContext): Record<string, unknown> {
  return {
    StateName: 'HPSummary',
    ModuleName: GET_ACCOUNTS_MODULE,
    SessionHeader: sessionHeader(ctx),
    ComboMethod: 'false',
    RequestedAccountTypes: LEUMI_ACCOUNT_TYPES,
    ExtAccountPermissions: 'General',
    AccountSegments: '',
  };
}

/**
 * Customer-step vars — the `UC_SO_GetAccounts` envelope.
 * @param ctx - Action context.
 * @returns Envelope vars map.
 */
export function customerVars(ctx: IActionContext): VarsMap {
  const inner = getAccountsInner(ctx);
  return wcfEnvelope(GET_ACCOUNTS_MODULE, inner);
}

/**
 * Map one raw AccountsItems entry to an account reference.
 * @param item - Raw account entry.
 * @returns Account reference (index + display number).
 */
function toAcct(item: ILeumiAccountItem): ILeumiAcct {
  const accountIndex = item.AccountIndex ?? 0;
  return { accountIndex, displayNumber: item.MaskedNumber ?? '' };
}

/**
 * Flatten `AccountsItems[]` into account references.
 * @param args - Extract-args bundle (reads args.body only).
 * @returns Account list (empty when the container is absent).
 */
export function extractAccounts(args: IExtractAccountsArgs): readonly ILeumiAcct[] {
  const resp = parseJsonResp(args.body) as unknown as IAccountsResp;
  const rows = resp.AccountsItems ?? [];
  return rows.map(toAcct);
}

/**
 * User-facing account number (MaskedNumber).
 * @param acct - Leumi account.
 * @returns Display number.
 */
export function accountNumberOf(acct: ILeumiAcct): AccountNumberDisplay {
  return acct.displayNumber as AccountNumberDisplay;
}

/**
 * Balance-step vars — shared UC_SO_27 builder, empty-range variant.
 * @param acct - Leumi account.
 * @param ctx - Action context.
 * @returns Envelope vars map.
 */
export function balanceVars(acct: ILeumiAcct, ctx: IActionContext): VarsMap {
  return ucSo27Vars(acct.accountIndex, ctx, BALANCE_VARIANT);
}

/**
 * Current balance — `BalanceDisplay` off the UC_SO_27 response.
 * @param body - Raw WCF response body.
 * @returns Current account balance.
 */
export function balanceExtract(body: ApiBody): AccountBalance {
  const resp = parseJsonResp(body) as unknown as IBalanceResp;
  return (resp.BalanceDisplay ?? 0) as AccountBalance;
}
