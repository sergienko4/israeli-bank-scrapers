import moment from 'moment';
import { type Frame, type Page, type Request } from 'playwright';
import { getDebug } from '../helpers/debug';
import { clickButton, elementPresentOnPage, pageEval, waitUntilElementFound } from '../helpers/elements-interactions';
import { fetchPost } from '../helpers/fetch';
import { getCurrentUrl, waitForNavigation } from '../helpers/navigation';
import { getFromSessionStorage } from '../helpers/storage';
import { filterOldTransactions, getRawTransaction } from '../helpers/transactions';
import { waitUntil } from '../helpers/waiting';
import { TransactionStatuses, TransactionTypes, type Transaction, type TransactionsAccount } from '../transactions';
import { BaseScraperWithBrowser, LoginResults, type LoginOptions } from './base-scraper-with-browser';
import { type ScraperScrapingResult, type ScraperOptions } from './interface';
import _ from 'lodash';

const apiHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  Origin: 'https://digital-web.cal-online.co.il',
  Referer: 'https://digital-web.cal-online.co.il',
  'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
};
const LOGIN_URL = 'https://www.cal-online.co.il/';
const TRANSACTIONS_REQUEST_ENDPOINT =
  'https://api.cal-online.co.il/Transactions/api/transactionsDetails/getCardTransactionsDetails';
const FRAMES_REQUEST_ENDPOINT = 'https://api.cal-online.co.il/Frames/api/Frames/GetFrameStatus';
const PENDING_TRANSACTIONS_REQUEST_ENDPOINT =
  'https://api.cal-online.co.il/Transactions/api/approvals/getClearanceRequests';
const SSO_AUTHORIZATION_REQUEST_ENDPOINT = 'https://connect.cal-online.co.il/col-rest/calconnect/authentication/SSO';

const InvalidPasswordMessage = 'שם המשתמש או הסיסמה שהוזנו שגויים';

const debug = getDebug('visa-cal');

import { TrnTypeCode, type AuthModule, type CardApiStatus, type CardPendingTransactionDetails, type CardTransactionDetails, type FramesResponse, type InitResponse, type ScrapedPendingTransaction, type ScrapedTransaction, authModuleOrUndefined, isPending, isCardTransactionDetails, isCardPendingTransactionDetails } from './visa-cal-types';
async function getLoginFrame(page: Page): Promise<Frame> {
  let frame: Frame | null = null;
  debug('wait until login frame found');
  await waitUntil(
    () => {
      frame = page.frames().find(f => f.url().includes('connect')) || null;
      return Promise.resolve(!!frame);
    },
    'wait for iframe with login form',
    { timeout: 10000, interval: 1000 },
  );

  if (!frame) {
    debug('failed to find login frame for 10 seconds');
    throw new Error('failed to extract login iframe');
  }

  return frame;
}

async function hasInvalidPasswordError(page: Page): Promise<boolean> {
  const frame = await getLoginFrame(page);
  const errorFound = await elementPresentOnPage(frame, 'div.general-error > div');
  const errorMessage = errorFound
    ? await pageEval(frame, { selector: 'div.general-error > div', defaultResult: '', callback: item => (item as HTMLDivElement).innerText })
    : '';
  return errorMessage === InvalidPasswordMessage;
}

async function hasChangePasswordForm(page: Page): Promise<boolean> {
  const frame = await getLoginFrame(page);
  const errorFound = await elementPresentOnPage(frame, '.change-password-subtitle');
  return errorFound;
}

const loginResultCheckers = {
  invalidPassword: async (options?: { page?: Page }) => options?.page ? hasInvalidPasswordError(options.page) : false,
  changePassword: async (options?: { page?: Page }) => options?.page ? hasChangePasswordForm(options.page) : false,
};

function getPossibleLoginResults(): Record<string, (Array<string | RegExp | ((options?: { page?: Page }) => Promise<boolean>)>)> {
  debug('return possible login results');
  return {
    [LoginResults.Success]: [/dashboard/i],
    [LoginResults.InvalidPassword]: [loginResultCheckers.invalidPassword],
    [LoginResults.ChangePassword]: [loginResultCheckers.changePassword],
  };
}

function createLoginFields(credentials: ScraperSpecificCredentials): Array<{ selector: string; value: string }> {
  debug('create login fields for username and password');
  return [
    { selector: '[formcontrolname="userName"]', value: credentials.username },
    { selector: '[formcontrolname="password"]', value: credentials.password },
  ];
}

function getInstallments(transaction: ScrapedTransaction | ScrapedPendingTransaction): { number: number; total: number } | undefined {
  const numOfPayments = isPending(transaction) ? transaction.numberOfPayments : transaction.numOfPayments;
  return numOfPayments ? { number: isPending(transaction) ? 1 : transaction.curPaymentNum, total: numOfPayments } : undefined;
}

function getTransactionAmounts(transaction: ScrapedTransaction | ScrapedPendingTransaction): { chargedAmount: number; originalAmount: number } {
  return {
    chargedAmount: (isPending(transaction) ? transaction.trnAmt : transaction.amtBeforeConvAndIndex) * -1,
    originalAmount: transaction.trnAmt * (transaction.trnTypeCode === TrnTypeCode.credit ? 1 : -1),
  };
}

function mapOneTransaction(transaction: ScrapedTransaction | ScrapedPendingTransaction, options?: ScraperOptions): Transaction {
  const installments = getInstallments(transaction);
  const date = moment(transaction.trnPurchaseDate);
  const { chargedAmount, originalAmount } = getTransactionAmounts(transaction);
  const isNormalType = [TrnTypeCode.regular, TrnTypeCode.standingOrder].includes(transaction.trnTypeCode);
  const result: Transaction = {
    identifier: !isPending(transaction) ? transaction.trnIntId : undefined,
    type: isNormalType ? TransactionTypes.Normal : TransactionTypes.Installments,
    status: isPending(transaction) ? TransactionStatuses.Pending : TransactionStatuses.Completed,
    date: installments ? date.add(installments.number - 1, 'month').toISOString() : date.toISOString(),
    processedDate: isPending(transaction) ? date.toISOString() : new Date(transaction.debCrdDate).toISOString(),
    originalAmount, originalCurrency: transaction.trnCurrencySymbol,
    chargedAmount, chargedCurrency: !isPending(transaction) ? transaction.debCrdCurrencySymbol : undefined,
    description: transaction.merchantName, memo: transaction.transTypeCommentDetails.toString(), category: transaction.branchCodeDesc,
  };
  if (installments) result.installments = installments;
  if (options?.includeRawTransaction) result.rawTransaction = getRawTransaction(transaction);
  return result;
}

function collectAllTransactions(data: CardTransactionDetails[], pendingData?: CardPendingTransactionDetails | null): (ScrapedTransaction | ScrapedPendingTransaction)[] {
  const pendingTransactions = pendingData?.result ? pendingData.result.cardsList.flatMap(card => card.authDetalisList) : [];
  const bankAccounts = data.flatMap(monthData => monthData.result.bankAccounts);
  const completedTransactions = [...bankAccounts.flatMap(a => a.debitDates), ...bankAccounts.flatMap(a => a.immidiateDebits.debitDays)].flatMap(d => d.transactions);
  return [...pendingTransactions, ...completedTransactions] as (ScrapedTransaction | ScrapedPendingTransaction)[];
}

function convertParsedDataToTransactions(data: CardTransactionDetails[], pendingData?: CardPendingTransactionDetails | null, options?: ScraperOptions): Transaction[] {
  return collectAllTransactions(data, pendingData).map(transaction => mapOneTransaction(transaction, options));
}

type ScraperSpecificCredentials = { username: string; password: string };

class VisaCalScraper extends BaseScraperWithBrowser<ScraperSpecificCredentials> {
  private authorization: string | undefined = undefined;

  private authRequestPromise: Promise<Request | undefined> | undefined;

  openLoginPopup = async (): Promise<Frame> => {
    debug('open login popup, wait until login button available');
    await waitUntilElementFound(this.page, '#ccLoginDesktopBtn', { visible: true });
    debug('click on the login button');
    await clickButton(this.page, '#ccLoginDesktopBtn');
    debug('get the frame that holds the login');
    const frame = await getLoginFrame(this.page);
    debug('wait until the password login tab header is available');
    await waitUntilElementFound(frame, '#regular-login');
    debug('navigate to the password login tab');
    await clickButton(frame, '#regular-login');
    debug('wait until the password login tab is active');
    await waitUntilElementFound(frame, 'regular-login');

    return frame;
  };

  async getCards(): Promise<Array<{ cardUniqueId: string; last4Digits: string }>> {
    const initData = await waitUntil(
      () => getFromSessionStorage<InitResponse>(this.page, 'init'),
      'get init data in session storage',
      { timeout: 10000, interval: 1000 },
    );
    if (!initData) {
      throw new Error('could not find "init" data in session storage');
    }
    return initData?.result.cards.map(({ cardUniqueId, last4Digits }) => ({ cardUniqueId, last4Digits }));
  }

  async getAuthorizationHeader(): Promise<string> {
    if (!this.authorization) {
      debug('fetching authorization header');
      const authModule = await waitUntil(
        async () => authModuleOrUndefined(await getFromSessionStorage<AuthModule>(this.page, 'auth-module')),
        'get authorization header with valid token in session storage',
        { timeout: 10_000, interval: 50 },
      );
      return `CALAuthScheme ${authModule.auth.calConnectToken}`;
    }
    return this.authorization;
  }

  async getXSiteId(): Promise<string> {
    /*
      I don't know if the constant below will change in the feature.
      If so, use the next code:

      return this.page.evaluate(() => new Ut().xSiteId);

      To get the classname search for 'xSiteId' in the page source
      class Ut {
        constructor(_e, on, yn) {
            this.store = _e,
            this.config = on,
            this.eventBusService = yn,
            this.xSiteId = "09031987-273E-2311-906C-8AF85B17C8D9",
    */
    return Promise.resolve('09031987-273E-2311-906C-8AF85B17C8D9');
  }

  private async handlePostLogin(): Promise<void> {
    try {
      await waitForNavigation(this.page);
      const currentUrl = await getCurrentUrl(this.page);
      if (currentUrl.endsWith('site-tutorial')) await clickButton(this.page, 'button.btn-close');
      const request = await this.authRequestPromise;
      this.authorization = String(request?.headers().authorization || '').trim();
    } catch (e) {
      const currentUrl = await getCurrentUrl(this.page);
      if (currentUrl.endsWith('dashboard')) return;
      if (await hasChangePasswordForm(this.page)) return;
      throw e;
    }
  }

  getLoginOptions(credentials: ScraperSpecificCredentials): LoginOptions {
    this.authRequestPromise = this.page
      .waitForRequest(SSO_AUTHORIZATION_REQUEST_ENDPOINT, { timeout: 10_000 })
      .catch(e => { debug('error while waiting for the token request', e); return undefined; });
    return {
      loginUrl: `${LOGIN_URL}`,
      fields: createLoginFields(credentials),
      submitButtonSelector: 'button[type="submit"]',
      possibleResults: getPossibleLoginResults(),
      checkReadiness: async () => waitUntilElementFound(this.page, '#ccLoginDesktopBtn'),
      preAction: this.openLoginPopup,
      postAction: () => this.handlePostLogin(),
    };
  }

  private buildApiHeaders(Authorization: string, xSiteId: string): Record<string, string> {
    return { Authorization, 'X-Site-Id': xSiteId, 'Content-Type': 'application/json', ...apiHeaders };
  }

  private async fetchMonthData(card: { cardUniqueId: string; last4Digits: string }, month: moment.Moment, hdrs: Record<string, string>): Promise<CardTransactionDetails> {
    const monthData = await fetchPost<CardTransactionDetails | CardApiStatus>(TRANSACTIONS_REQUEST_ENDPOINT, { cardUniqueId: card.cardUniqueId, month: month.format('M'), year: month.format('YYYY') }, hdrs);
    if (monthData?.statusCode !== 1) throw new Error(`failed to fetch transactions for card ${card.last4Digits}. Message: ${monthData?.title || ''}`);
    if (!isCardTransactionDetails(monthData)) throw new Error('monthData is not of type CardTransactionDetails');
    return monthData;
  }

  private async fetchPendingData(card: { cardUniqueId: string; last4Digits: string }, hdrs: Record<string, string>): Promise<CardPendingTransactionDetails | null> {
    debug(`fetch pending transactions for card ${card.cardUniqueId}`);
    let pendingData: CardPendingTransactionDetails | CardApiStatus | null = await fetchPost<CardPendingTransactionDetails | CardApiStatus>(PENDING_TRANSACTIONS_REQUEST_ENDPOINT, { cardUniqueIDArray: [card.cardUniqueId] }, hdrs);
    if (pendingData?.statusCode !== 1 && pendingData?.statusCode !== 96) {
      debug(`failed to fetch pending transactions for card ${card.last4Digits}. Message: ${pendingData?.title || ''}`);
      pendingData = null;
    } else if (!isCardPendingTransactionDetails(pendingData)) {
      debug('pendingData is not of type CardTransactionDetails');
      pendingData = null;
    }
    return pendingData;
  }

  private async fetchCardDataMonths(card: { cardUniqueId: string; last4Digits: string }, allMonths: moment.Moment[], hdrs: Record<string, string>): Promise<CardTransactionDetails[]> {
    const allMonthsData: CardTransactionDetails[] = [];
    for (const month of allMonths) allMonthsData.push(await this.fetchMonthData(card, month, hdrs));
    return allMonthsData;
  }

  private async fetchCardData(card: { cardUniqueId: string; last4Digits: string }, opts: { startMoment: moment.Moment; futureMonthsToScrape: number; hdrs: Record<string, string> }): Promise<CardTransactionDetails[]> {
    const { startMoment, futureMonthsToScrape, hdrs } = opts;
    const finalMonthToFetchMoment = moment().add(futureMonthsToScrape, 'month');
    const months = finalMonthToFetchMoment.diff(startMoment, 'months');
    const allMonths = Array.from({ length: months + 1 }, (_, i) => finalMonthToFetchMoment.clone().subtract(i, 'months'));
    debug(`fetch completed transactions for card ${card.cardUniqueId}`);
    return this.fetchCardDataMonths(card, allMonths, hdrs);
  }

  private async fetchAllCardAccounts(cards: Array<{ cardUniqueId: string; last4Digits: string }>, ctx: { startDate: Date; startMoment: moment.Moment; hdrs: Record<string, string>; frames: FramesResponse }): Promise<TransactionsAccount[]> {
    const { startDate, startMoment, hdrs, frames } = ctx;
    const futureMonthsToScrape = this.options.futureMonthsToScrape ?? 1;
    return Promise.all(cards.map(async card => {
      const frame = _.find(frames.result?.bankIssuedCards?.cardLevelFrames, { cardUniqueId: card.cardUniqueId });
      const pendingData = await this.fetchPendingData(card, hdrs);
      const allMonthsData = await this.fetchCardData(card, { startMoment, futureMonthsToScrape, hdrs });
      const transactions = convertParsedDataToTransactions(allMonthsData, pendingData, this.options);
      const txns = (this.options.outputData?.enableTransactionsFilterByDate ?? true) ? filterOldTransactions(transactions, moment(startDate), this.options.combineInstallments || false) : transactions;
      return { txns, balance: frame?.nextTotalDebit != null ? -frame.nextTotalDebit : undefined, accountNumber: card.last4Digits } as TransactionsAccount;
    }));
  }

  async fetchData(): Promise<ScraperScrapingResult> {
    const defaultStartMoment = moment().subtract(1, 'years').subtract(6, 'months').add(1, 'day');
    const startDate = this.options.startDate || defaultStartMoment.toDate();
    const startMoment = moment.max(defaultStartMoment, moment(startDate));
    debug(`fetch transactions starting ${startMoment.format()}`);
    const [cards, xSiteId, Authorization] = await Promise.all([this.getCards(), this.getXSiteId(), this.getAuthorizationHeader()]);
    const hdrs = this.buildApiHeaders(Authorization, xSiteId);
    debug('fetch frames (misgarot) of cards');
    const frames = await fetchPost<FramesResponse>(FRAMES_REQUEST_ENDPOINT, { cardsForFrameData: cards.map(({ cardUniqueId }) => ({ cardUniqueId })) }, hdrs);
    const accounts = await this.fetchAllCardAccounts(cards, { startDate, startMoment, hdrs, frames });
    debug(`return ${accounts.length} scraped accounts`);
    return { success: true, accounts };
  }
}

export default VisaCalScraper;
