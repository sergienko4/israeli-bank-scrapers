import moment from 'moment';
import { type Frame, type Page } from 'playwright';

import { getDebug } from '../../Common/Debug';
import {
  elementPresentOnPage,
  pageEval,
  waitUntilIframeFound,
} from '../../Common/ElementsInteractions';
import { getRawTransaction } from '../../Common/Transactions';
import type { FoundResult } from '../../Interfaces/Common/FoundResult';
import { type ITransaction, TransactionStatuses, TransactionTypes } from '../../Transactions';
import { LOGIN_RESULTS } from '../Base/BaseScraperWithBrowser';
import { type ScraperOptions } from '../Base/Interface';
import { ScraperWebsiteChangedError } from '../Base/ScraperWebsiteChangedError';
import {
  type ICardApiStatus,
  type ICardInfo,
  type ICardLevelFrame,
  type ICardPendingTransactionDetails,
  type ICardTransactionDetails,
  type IFramesResponse,
  isCardPendingTransactionDetails,
  isCardTransactionDetails,
  type IScrapedPendingTransaction,
  type IScrapedTransaction,
  isPending,
  TrnTypeCode,
} from './VisaCalTypes';

const LOG = getDebug('visa-cal');
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
 * Checks whether a Playwright frame is the VisaCal connect.cal-online.co.il login iframe.
 *
 * @param f - the frame to check
 * @returns true if the frame URL includes 'connect'
 */
export function isConnectFrame(f: Frame): boolean {
  return f.url().includes('connect');
}

/**
 * Checks whether the VisaCal login iframe shows an invalid-password error.
 *
 * @param page - the Playwright page containing the login iframe
 * @returns true if the Hebrew invalid-password error text is displayed
 */
export async function hasInvalidPasswordError(page: Page): Promise<boolean> {
  try {
    const frame = await waitUntilIframeFound(page, isConnectFrame, CONNECT_IFRAME_CHECK_OPTS);
    const isErrorFound = await elementPresentOnPage(frame, 'div.general-error > div');
    const errorMessage = isErrorFound
      ? await pageEval(frame, {
          selector: 'div.general-error > div',
          defaultResult: '',
          /**
           * Extracts the inner text from the error div.
           *
           * @param item - the matched error div element
           * @returns the inner text of the error div
           */
          callback: item => (item as HTMLDivElement).innerText,
        })
      : '';
    return errorMessage === INVALID_PASSWORD_MESSAGE;
  } catch {
    return false; // iframe gone = page navigated away = no invalid-password error
  }
}

/**
 * Checks whether the VisaCal login iframe shows the change-password form.
 *
 * @param page - the Playwright page containing the login iframe
 * @returns true if the change-password subtitle element is present
 */
export async function hasChangePasswordForm(page: Page): Promise<boolean> {
  try {
    const frame = await waitUntilIframeFound(page, isConnectFrame, CONNECT_IFRAME_CHECK_OPTS);
    return await elementPresentOnPage(frame, '.change-password-subtitle');
  } catch {
    return false; // iframe gone = page navigated away = no change-password form
  }
}

/**
 * Returns the possible login result conditions for VisaCal login.
 *
 * @returns a map of login result keys to arrays of URL/function conditions
 */
export function getPossibleLoginResults(): Record<
  string,
  (string | RegExp | ((options?: { page?: Page }) => Promise<boolean>))[]
> {
  LOG.info('return possible login results');
  return {
    [LOGIN_RESULTS.Success]: [/dashboard/i, /cal-online\.co\.il\/#/],
    [LOGIN_RESULTS.InvalidPassword]: [
      async (opts?: { page?: Page }): Promise<boolean> =>
        opts?.page ? hasInvalidPasswordError(opts.page) : false,
    ],
    [LOGIN_RESULTS.ChangePassword]: [
      async (opts?: { page?: Page }): Promise<boolean> =>
        opts?.page ? hasChangePasswordForm(opts.page) : false,
    ],
  };
}

/**
 * Creates the login field descriptors for the VisaCal login form.
 *
 * @param credentials - VisaCal login credentials
 * @param credentials.username - the VisaCal username
 * @param credentials.password - the VisaCal password
 * @returns an array of field descriptors with CSS selectors and values
 */
export function createLoginFields(credentials: {
  username: string;
  password: string;
}): { selector: string; value: string }[] {
  LOG.info('create login fields for username and password');
  return [
    { selector: '[formcontrolname="userName"]', value: credentials.username },
    { selector: '[formcontrolname="password"]', value: credentials.password },
  ];
}

/**
 * Extracts installment plan info from a VisaCal transaction.
 *
 * @param transaction - the scraped transaction (pending or completed)
 * @returns FoundResult wrapping installment info, or isFound=false if not an installment
 */
export function getInstallments(
  transaction: IScrapedTransaction | IScrapedPendingTransaction,
): FoundResult<{ number: number; total: number }> {
  const numOfPayments = isPending(transaction)
    ? transaction.numberOfPayments
    : transaction.numOfPayments;
  if (!numOfPayments) return { isFound: false };
  const number = isPending(transaction) ? 1 : transaction.curPaymentNum;
  return { isFound: true, value: { number, total: numOfPayments } };
}

/**
 * Computes the charged and original amounts for a VisaCal transaction.
 *
 * @param transaction - the scraped transaction (pending or completed)
 * @returns the charged and original amounts with correct sign
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
 * Calculates the effective transaction date, adjusted for installment number.
 *
 * @param date - the base purchase date
 * @param installments - the installment FoundResult (if applicable)
 * @returns the ISO date string for the transaction
 */
function getTxnDate(
  date: moment.Moment,
  installments: FoundResult<{ number: number; total: number }>,
): string {
  return installments.isFound
    ? date.add(installments.value.number - 1, 'month').toISOString()
    : date.toISOString();
}

/**
 * Returns the processed (debit) date for a transaction.
 *
 * @param transaction - the scraped transaction (pending or completed)
 * @param date - the base purchase date (used for pending transactions)
 * @returns the ISO date string for when the transaction is processed
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
 * Returns Pending or Completed TransactionStatuses based on the pending flag.
 *
 * @param isPendingTxn - whether the transaction is pending
 * @returns the corresponding TransactionStatuses value
 */
function buildTxnStatus(isPendingTxn: boolean): TransactionStatuses {
  return isPendingTxn ? TransactionStatuses.Pending : TransactionStatuses.Completed;
}

export interface ITransactionAmounts {
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency: string | undefined;
}

/**
 * Builds the amount fields for a VisaCal transaction.
 *
 * @param transaction - the scraped transaction (pending or completed)
 * @param isPendingTxn - whether the transaction is pending
 * @returns the original and charged amounts with currency codes
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
 * Builds the core ITransaction fields from a scraped VisaCal transaction.
 *
 * @param opts - transaction base options with the raw transaction, date, and installment info
 * @returns a ITransaction object without rawTransaction
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
 * Converts a single scraped VisaCal transaction to a normalized ITransaction.
 *
 * @param transaction - the raw scraped transaction (pending or completed)
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns a complete ITransaction object
 */
export function mapOneTransaction(
  transaction: IScrapedTransaction | IScrapedPendingTransaction,
  options?: ScraperOptions,
): ITransaction {
  const installments = getInstallments(transaction);
  const date = moment(transaction.trnPurchaseDate);
  const result = buildTransactionBase({ transaction, date, installments });
  if (installments.isFound) result.installments = installments.value;
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(transaction);
  return result;
}

/**
 * Merges all completed and pending transactions from the VisaCal API response into a single array.
 *
 * @param data - array of completed card transaction details per month
 * @param pendingData - optional pending card transaction details
 * @returns all scraped transactions combined into one array
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
 * Converts all collected VisaCal transaction data into normalized ITransaction objects.
 *
 * @param data - array of completed card transaction details per month
 * @param pendingData - optional pending card transaction details
 * @param options - scraper options controlling rawTransaction inclusion
 * @returns all transactions as normalized ITransaction objects
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

/**
 * Finds the ICardLevelFrame for a specific card from the VisaCal frames response.
 *
 * @param frames - the frames response from the VisaCal API
 * @param cardUniqueId - the unique card identifier to search for
 * @returns FoundResult wrapping the matching ICardLevelFrame, or isFound=false if not found
 */
export function findCardFrame(
  frames: IFramesResponse,
  cardUniqueId: string,
): FoundResult<ICardLevelFrame> {
  const frame = frames.result?.bankIssuedCards?.cardLevelFrames?.find(
    f => f.cardUniqueId === cardUniqueId,
  );
  return frame ? { isFound: true, value: frame } : { isFound: false };
}

const LOG_HELPERS = getDebug('visa-cal');

/**
 * Validates the raw pending data response and converts it to a FoundResult.
 *
 * @param raw - the raw pending data response
 * @param card - the card info (used in log messages)
 * @returns FoundResult wrapping the pending details, or isFound=false on invalid status
 */
export function parsePendingData(
  raw: ICardPendingTransactionDetails | ICardApiStatus,
  card: ICardInfo,
): FoundResult<ICardPendingTransactionDetails> {
  if (raw.statusCode !== 1 && raw.statusCode !== 96) {
    LOG_HELPERS.info(
      `failed to fetch pending for card ${card.last4Digits}. Message: ${raw.title ?? ''}`,
    );
    return { isFound: false };
  }
  if (!isCardPendingTransactionDetails(raw)) {
    LOG_HELPERS.info('pendingData is not of type ICardTransactionDetails');
    return { isFound: false };
  }
  return { isFound: true, value: raw };
}

/**
 * Asserts that the monthly transaction data response is valid; throws if status indicates failure.
 *
 * @param monthData - the API response to validate
 * @param card - the card info (used in error messages)
 */
export function validateMonthDataResponse(
  monthData: ICardTransactionDetails | ICardApiStatus,
  card: ICardInfo,
): asserts monthData is ICardTransactionDetails {
  if (monthData.statusCode !== 1) {
    const desc = monthData.title ?? `statusCode=${String(monthData.statusCode)}`;
    throw new ScraperWebsiteChangedError('VisaCal', `fetch card ${card.last4Digits}: ${desc}`);
  }
  if (!isCardTransactionDetails(monthData))
    throw new ScraperWebsiteChangedError(
      'VisaCal',
      'monthData is not of type ICardTransactionDetails',
    );
}
