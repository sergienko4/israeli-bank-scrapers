import moment from 'moment';
import { type Frame, type Page } from 'playwright';

import { elementPresentOnPage, waitUntilIframeFound } from '../../Common/ElementsInteractions.js';
import { getRawTransaction } from '../../Common/Transactions.js';
import { type ITransaction, TransactionStatuses, TransactionTypes } from '../../Transactions.js';
import { type ScraperOptions } from '../Base/Interface.js';
import {
  type ICardLevelFrame,
  type ICardPendingTransactionDetails,
  type ICardTransactionDetails,
  type IFramesResponse,
  type IScrapedPendingTransaction,
  type IScrapedTransaction,
  isPending,
  TrnTypeCode,
} from './VisaCalTypes.js';

const INVALID_PASSWORD_MESSAGE = 'שם המשתמש או הסיסמה שהוזנו שגויים';
export const CONNECT_IFRAME_OPTS = {
  timeout: 45000,
  description: 'login iframe (connect.cal-online.co.il)',
} as const;

// Short timeout for login-state checks: if iframe is gone (post-redirect), fail fast
const CONNECT_IFRAME_CHECK_OPTS = {
  timeout: 3000,
  description: 'login iframe check',
} as const;

/**
 * Check whether the given frame URL belongs to the connect login iframe.
 * @param frame - The Playwright frame to inspect.
 * @returns True if the frame URL contains 'connect'.
 */
export function isConnectFrame(frame: Frame): boolean {
  return frame.url().includes('connect');
}

/**
 * Detect whether the login iframe shows an invalid-password error message.
 * @param page - The Playwright page to inspect.
 * @returns True if invalid-password error is visible.
 */
export async function hasInvalidPasswordError(page: Page): Promise<boolean> {
  try {
    const frame = await waitUntilIframeFound(page, isConnectFrame, CONNECT_IFRAME_CHECK_OPTS);
    return await elementPresentOnPage(frame, `text=${INVALID_PASSWORD_MESSAGE}`);
  } catch {
    return false; // iframe gone = page navigated away = no invalid-password error
  }
}

/**
 * Detect whether the login iframe shows a change-password form.
 * @param page - The Playwright page to inspect.
 * @returns True if a change-password form is visible.
 */
export async function hasChangePasswordForm(page: Page): Promise<boolean> {
  try {
    const frame = await waitUntilIframeFound(page, isConnectFrame, CONNECT_IFRAME_CHECK_OPTS);
    return await elementPresentOnPage(frame, 'text=שינוי סיסמה');
  } catch {
    return false; // iframe gone = page navigated away = no change-password form
  }
}

type OptionalInstallments = { number: number; total: number } | undefined;

/**
 * Extract installment info from a transaction, if applicable.
 * @param transaction - A completed or pending VisaCal transaction.
 * @returns Installment number and total, or undefined if not an installment.
 */
export function getInstallments(
  transaction: IScrapedTransaction | IScrapedPendingTransaction,
): OptionalInstallments {
  const numOfPayments = isPending(transaction)
    ? transaction.numberOfPayments
    : transaction.numOfPayments;
  return numOfPayments
    ? { number: isPending(transaction) ? 1 : transaction.curPaymentNum, total: numOfPayments }
    : undefined;
}

/**
 * Calculate charged and original amounts from a transaction.
 * @param transaction - A completed or pending VisaCal transaction.
 * @returns Object with chargedAmount and originalAmount.
 */
export function getTransactionAmounts(
  transaction: IScrapedTransaction | IScrapedPendingTransaction,
): {
  chargedAmount: number;
  originalAmount: number;
} {
  return {
    chargedAmount:
      (isPending(transaction) ? transaction.trnAmt : transaction.amtBeforeConvAndIndex) * -1,
    originalAmount: transaction.trnAmt * (transaction.trnTypeCode === TrnTypeCode.Credit ? 1 : -1),
  };
}

interface ITransactionBaseOpts {
  transaction: IScrapedTransaction | IScrapedPendingTransaction;
  date: moment.Moment;
  installments: ReturnType<typeof getInstallments>;
}

/**
 * Compute the transaction date, adjusting for installment offset.
 * @param date - The base purchase date.
 * @param installments - Installment info, if applicable.
 * @returns ISO date string.
 */
function getTxnDate(date: moment.Moment, installments: ReturnType<typeof getInstallments>): string {
  return installments
    ? date.add(installments.number - 1, 'month').toISOString()
    : date.toISOString();
}

/**
 * Determine the processed date based on transaction type.
 * @param transaction - A completed or pending transaction.
 * @param date - The purchase date moment.
 * @returns ISO date string for the processed date.
 */
function getProcessedDate(
  transaction: IScrapedTransaction | IScrapedPendingTransaction,
  date: moment.Moment,
): string {
  return isPending(transaction)
    ? date.toISOString()
    : new Date(transaction.debCrdDate).toISOString();
}

const NORMAL_TYPE_CODES = [TrnTypeCode.Regular, TrnTypeCode.StandingOrder];

/**
 * Map a boolean pending flag to the appropriate TransactionStatuses value.
 * @param isPendingTxn - True if the transaction is pending.
 * @returns The corresponding TransactionStatuses enum value.
 */
function buildTxnStatus(isPendingTxn: boolean): TransactionStatuses {
  return isPendingTxn ? TransactionStatuses.Pending : TransactionStatuses.Completed;
}

interface ITransactionAmounts {
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency: string | undefined;
}

/**
 * Build the amount fields for a transaction record.
 * @param transaction - A completed or pending transaction.
 * @param isPendingTxn - True if the transaction is pending.
 * @returns Object with original and charged amounts and currencies.
 */
function buildTxnAmounts(
  transaction: IScrapedTransaction | IScrapedPendingTransaction,
  isPendingTxn: boolean,
): ITransactionAmounts {
  const { chargedAmount, originalAmount } = getTransactionAmounts(transaction);
  const chargedCurrency = isPendingTxn
    ? undefined
    : (transaction as IScrapedTransaction).debCrdCurrencySymbol;
  return {
    originalAmount,
    originalCurrency: transaction.trnCurrencySymbol,
    chargedAmount,
    chargedCurrency,
  };
}

/**
 * Assemble the base ITransaction object from a scraped VisaCal transaction.
 * @param opts - Transaction data, date, and installment info.
 * @returns A fully populated ITransaction record.
 */
function buildTransactionBase(opts: ITransactionBaseOpts): ITransaction {
  const { transaction, date, installments } = opts;
  const isPendingTxn = isPending(transaction);
  return {
    identifier: !isPendingTxn ? transaction.trnIntId : undefined,
    type: NORMAL_TYPE_CODES.includes(transaction.trnTypeCode)
      ? TransactionTypes.Normal
      : TransactionTypes.Installments,
    status: buildTxnStatus(isPendingTxn),
    date: getTxnDate(date, installments),
    processedDate: getProcessedDate(transaction, date),
    ...buildTxnAmounts(transaction, isPendingTxn),
    description: transaction.merchantName,
    memo: transaction.transTypeCommentDetails.toString(),
    category: transaction.branchCodeDesc,
  };
}

/**
 * Map a single VisaCal transaction to an ITransaction, with optional raw data.
 * @param transaction - A completed or pending VisaCal transaction.
 * @param options - Optional scraper settings controlling raw-data inclusion.
 * @returns A mapped ITransaction record.
 */
export function mapOneTransaction(
  transaction: IScrapedTransaction | IScrapedPendingTransaction,
  options?: ScraperOptions,
): ITransaction {
  const installments = getInstallments(transaction);
  const date = moment(transaction.trnPurchaseDate);
  const result = buildTransactionBase({ transaction, date, installments });
  if (installments) result.installments = installments;
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(transaction);
  return result;
}

/**
 * Collect all transactions from completed and pending data sources.
 * @param data - Array of completed card transaction details.
 * @param pendingData - Optional pending transaction details.
 * @returns Combined array of all scraped transactions.
 */
export function collectAllTransactions(
  data: ICardTransactionDetails[],
  pendingData?: ICardPendingTransactionDetails,
): (IScrapedTransaction | IScrapedPendingTransaction)[] {
  const pendingTransactions = pendingData?.result
    ? pendingData.result.cardsList.flatMap(card => card.authDetalisList)
    : [];
  const bankAccounts = data.flatMap(monthData => monthData.result.bankAccounts);
  const completedTransactions = [
    ...bankAccounts.flatMap(a => a.debitDates),
    ...bankAccounts.flatMap(a => a.immidiateDebits.debitDays),
  ].flatMap(d => d.transactions);
  return [...pendingTransactions, ...completedTransactions] as (
    | IScrapedTransaction
    | IScrapedPendingTransaction
  )[];
}

/**
 * Convert all parsed VisaCal data into ITransaction objects.
 * @param data - Array of completed card transaction details.
 * @param pendingData - Optional pending transaction details.
 * @param options - Scraper options controlling raw-data inclusion.
 * @returns Array of mapped ITransaction objects.
 */
export function convertParsedDataToTransactions(
  data: ICardTransactionDetails[],
  pendingData?: ICardPendingTransactionDetails,
  options?: ScraperOptions,
): ITransaction[] {
  return collectAllTransactions(data, pendingData).map(transaction =>
    mapOneTransaction(transaction, options),
  );
}

type OptionalCardFrame = ICardLevelFrame | undefined;

/**
 * Find the card-level frame matching a specific card unique ID.
 * @param frames - The frames response from the VisaCal API.
 * @param cardUniqueId - The card ID to search for.
 * @returns The matching card frame, or undefined if not found.
 */
export function findCardFrame(frames: IFramesResponse, cardUniqueId: string): OptionalCardFrame {
  return frames.result?.bankIssuedCards?.cardLevelFrames?.find(
    f => f.cardUniqueId === cardUniqueId,
  );
}
