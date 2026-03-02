import moment from 'moment';
import { type Frame, type Page } from 'playwright';

import { getDebug } from '../Helpers/Debug';
import {
  elementPresentOnPage,
  pageEval,
  waitUntilIframeFound,
} from '../Helpers/ElementsInteractions';
import { getRawTransaction } from '../Helpers/Transactions';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../Transactions';
import { LOGIN_RESULTS } from './BaseScraperWithBrowser';
import { type ScraperOptions } from './Interface';
import {
  type CardLevelFrame,
  type CardPendingTransactionDetails,
  type CardTransactionDetails,
  type FramesResponse,
  isPending,
  type ScrapedPendingTransaction,
  type ScrapedTransaction,
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

export function isConnectFrame(f: Frame): boolean {
  return f.url().includes('connect');
}

export async function hasInvalidPasswordError(page: Page): Promise<boolean> {
  try {
    const frame = await waitUntilIframeFound(page, isConnectFrame, CONNECT_IFRAME_CHECK_OPTS);
    const isErrorFound = await elementPresentOnPage(frame, 'div.general-error > div');
    const errorMessage = isErrorFound
      ? await pageEval(frame, {
          selector: 'div.general-error > div',
          defaultResult: '',
          callback: item => (item as HTMLDivElement).innerText,
        })
      : '';
    return errorMessage === INVALID_PASSWORD_MESSAGE;
  } catch {
    return false; // iframe gone = page navigated away = no invalid-password error
  }
}

export async function hasChangePasswordForm(page: Page): Promise<boolean> {
  try {
    const frame = await waitUntilIframeFound(page, isConnectFrame, CONNECT_IFRAME_CHECK_OPTS);
    return await elementPresentOnPage(frame, '.change-password-subtitle');
  } catch {
    return false; // iframe gone = page navigated away = no change-password form
  }
}

export function getPossibleLoginResults(): Record<
  string,
  (string | RegExp | ((options?: { page?: Page }) => Promise<boolean>))[]
> {
  LOG.info('return possible login results');
  return {
    [LOGIN_RESULTS.Success]: [/dashboard/i, /cal-online\.co\.il\/#/],
    [LOGIN_RESULTS.InvalidPassword]: [
      async (opts?: { page?: Page }) => (opts?.page ? hasInvalidPasswordError(opts.page) : false),
    ],
    [LOGIN_RESULTS.ChangePassword]: [
      async (opts?: { page?: Page }) => (opts?.page ? hasChangePasswordForm(opts.page) : false),
    ],
  };
}

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

export function getInstallments(
  transaction: ScrapedTransaction | ScrapedPendingTransaction,
): { number: number; total: number } | undefined {
  const numOfPayments = isPending(transaction)
    ? transaction.numberOfPayments
    : transaction.numOfPayments;
  return numOfPayments
    ? { number: isPending(transaction) ? 1 : transaction.curPaymentNum, total: numOfPayments }
    : undefined;
}

export function getTransactionAmounts(
  transaction: ScrapedTransaction | ScrapedPendingTransaction,
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

interface TxnBaseOpts {
  transaction: ScrapedTransaction | ScrapedPendingTransaction;
  date: moment.Moment;
  installments: ReturnType<typeof getInstallments>;
}

function getTxnDate(date: moment.Moment, installments: ReturnType<typeof getInstallments>): string {
  return installments
    ? date.add(installments.number - 1, 'month').toISOString()
    : date.toISOString();
}

function getProcessedDate(
  transaction: ScrapedTransaction | ScrapedPendingTransaction,
  date: moment.Moment,
): string {
  return isPending(transaction)
    ? date.toISOString()
    : new Date(transaction.debCrdDate).toISOString();
}

const NORMAL_TYPE_CODES = [TrnTypeCode.Regular, TrnTypeCode.StandingOrder];

function buildTxnStatus(isPendingTxn: boolean): TransactionStatuses {
  return isPendingTxn ? TransactionStatuses.Pending : TransactionStatuses.Completed;
}

interface TxnAmounts {
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number;
  chargedCurrency: string | undefined;
}

function buildTxnAmounts(
  transaction: ScrapedTransaction | ScrapedPendingTransaction,
  isPendingTxn: boolean,
): TxnAmounts {
  const { chargedAmount, originalAmount } = getTransactionAmounts(transaction);
  const chargedCurrency = isPendingTxn
    ? undefined
    : (transaction as ScrapedTransaction).debCrdCurrencySymbol;
  return {
    originalAmount,
    originalCurrency: transaction.trnCurrencySymbol,
    chargedAmount,
    chargedCurrency,
  };
}

function buildTransactionBase(opts: TxnBaseOpts): Transaction {
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

export function mapOneTransaction(
  transaction: ScrapedTransaction | ScrapedPendingTransaction,
  options?: ScraperOptions,
): Transaction {
  const installments = getInstallments(transaction);
  const date = moment(transaction.trnPurchaseDate);
  const result = buildTransactionBase({ transaction, date, installments });
  if (installments) result.installments = installments;
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(transaction);
  return result;
}

export function collectAllTransactions(
  data: CardTransactionDetails[],
  pendingData?: CardPendingTransactionDetails | null,
): (ScrapedTransaction | ScrapedPendingTransaction)[] {
  const pendingTransactions = pendingData?.result
    ? pendingData.result.cardsList.flatMap(card => card.authDetalisList)
    : [];
  const bankAccounts = data.flatMap(monthData => monthData.result.bankAccounts);
  const completedTransactions = [
    ...bankAccounts.flatMap(a => a.debitDates),
    ...bankAccounts.flatMap(a => a.immidiateDebits.debitDays),
  ].flatMap(d => d.transactions);
  return [...pendingTransactions, ...completedTransactions] as (
    | ScrapedTransaction
    | ScrapedPendingTransaction
  )[];
}

export function convertParsedDataToTransactions(
  data: CardTransactionDetails[],
  pendingData?: CardPendingTransactionDetails | null,
  options?: ScraperOptions,
): Transaction[] {
  return collectAllTransactions(data, pendingData).map(transaction =>
    mapOneTransaction(transaction, options),
  );
}

export function findCardFrame(
  frames: FramesResponse,
  cardUniqueId: string,
): CardLevelFrame | undefined {
  return frames.result?.bankIssuedCards?.cardLevelFrames?.find(
    f => f.cardUniqueId === cardUniqueId,
  );
}
