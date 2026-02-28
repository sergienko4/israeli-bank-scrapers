import moment from 'moment';
import { type Frame, type Page } from 'playwright';
import { getDebug } from '../helpers/debug';
import { elementPresentOnPage, pageEval } from '../helpers/elements-interactions';
import { getRawTransaction } from '../helpers/transactions';
import { waitUntil } from '../helpers/waiting';
import { TransactionStatuses, TransactionTypes, type Transaction } from '../transactions';
import { LoginResults } from './base-scraper-with-browser';
import { type ScraperOptions } from './interface';
import {
  TrnTypeCode,
  type CardPendingTransactionDetails,
  type CardTransactionDetails,
  type ScrapedPendingTransaction,
  type ScrapedTransaction,
  isPending,
} from './visa-cal-types';

const debug = getDebug('visa-cal');
const InvalidPasswordMessage = 'שם המשתמש או הסיסמה שהוזנו שגויים';

export async function getLoginFrame(page: Page): Promise<Frame> {
  let frame: Frame | null = null;
  debug('wait until login frame found');
  await waitUntil(
    () => {
      frame = page.frames().find(f => f.url().includes('connect')) || null;
      return Promise.resolve(!!frame);
    },
    'wait for iframe with login form',
    { timeout: 45000, interval: 1000 },
  );

  if (!frame) {
    debug('failed to find login frame for 45 seconds');
    throw new Error('failed to extract login iframe');
  }

  return frame;
}

export async function hasInvalidPasswordError(page: Page): Promise<boolean> {
  const frame = await getLoginFrame(page);
  const errorFound = await elementPresentOnPage(frame, 'div.general-error > div');
  const errorMessage = errorFound
    ? await pageEval(frame, {
        selector: 'div.general-error > div',
        defaultResult: '',
        callback: item => (item as HTMLDivElement).innerText,
      })
    : '';
  return errorMessage === InvalidPasswordMessage;
}

export async function hasChangePasswordForm(page: Page): Promise<boolean> {
  const frame = await getLoginFrame(page);
  const errorFound = await elementPresentOnPage(frame, '.change-password-subtitle');
  return errorFound;
}

export function getPossibleLoginResults(): Record<
  string,
  Array<string | RegExp | ((options?: { page?: Page }) => Promise<boolean>)>
> {
  debug('return possible login results');
  return {
    [LoginResults.Success]: [/dashboard/i],
    [LoginResults.InvalidPassword]: [
      async (opts?: { page?: Page }) => (opts?.page ? hasInvalidPasswordError(opts.page) : false),
    ],
    [LoginResults.ChangePassword]: [
      async (opts?: { page?: Page }) => (opts?.page ? hasChangePasswordForm(opts.page) : false),
    ],
  };
}

export function createLoginFields(credentials: {
  username: string;
  password: string;
}): Array<{ selector: string; value: string }> {
  debug('create login fields for username and password');
  return [
    { selector: '[formcontrolname="userName"]', value: credentials.username },
    { selector: '[formcontrolname="password"]', value: credentials.password },
  ];
}

export function getInstallments(
  transaction: ScrapedTransaction | ScrapedPendingTransaction,
): { number: number; total: number } | undefined {
  const numOfPayments = isPending(transaction) ? transaction.numberOfPayments : transaction.numOfPayments;
  return numOfPayments
    ? { number: isPending(transaction) ? 1 : transaction.curPaymentNum, total: numOfPayments }
    : undefined;
}

export function getTransactionAmounts(transaction: ScrapedTransaction | ScrapedPendingTransaction): {
  chargedAmount: number;
  originalAmount: number;
} {
  return {
    chargedAmount: (isPending(transaction) ? transaction.trnAmt : transaction.amtBeforeConvAndIndex) * -1,
    originalAmount: transaction.trnAmt * (transaction.trnTypeCode === TrnTypeCode.credit ? 1 : -1),
  };
}

interface TxnBaseOpts {
  transaction: ScrapedTransaction | ScrapedPendingTransaction;
  date: moment.Moment;
  installments: ReturnType<typeof getInstallments>;
}

function buildTransactionBase(opts: TxnBaseOpts): Transaction {
  const { transaction, date, installments } = opts;
  const { chargedAmount, originalAmount } = getTransactionAmounts(transaction);
  const isNormalType = [TrnTypeCode.regular, TrnTypeCode.standingOrder].includes(transaction.trnTypeCode);
  return {
    identifier: !isPending(transaction) ? transaction.trnIntId : undefined,
    type: isNormalType ? TransactionTypes.Normal : TransactionTypes.Installments,
    status: isPending(transaction) ? TransactionStatuses.Pending : TransactionStatuses.Completed,
    date: installments ? date.add(installments.number - 1, 'month').toISOString() : date.toISOString(),
    processedDate: isPending(transaction) ? date.toISOString() : new Date(transaction.debCrdDate).toISOString(),
    originalAmount,
    originalCurrency: transaction.trnCurrencySymbol,
    chargedAmount,
    chargedCurrency: !isPending(transaction) ? transaction.debCrdCurrencySymbol : undefined,
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
  return [...pendingTransactions, ...completedTransactions] as (ScrapedTransaction | ScrapedPendingTransaction)[];
}

export function convertParsedDataToTransactions(
  data: CardTransactionDetails[],
  pendingData?: CardPendingTransactionDetails | null,
  options?: ScraperOptions,
): Transaction[] {
  return collectAllTransactions(data, pendingData).map(transaction => mapOneTransaction(transaction, options));
}
