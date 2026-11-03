/**
 * Discount Titan reads — the answer check every Titan call runs and the
 * headers every Titan call sends. Bodies are synthetic
 * structural fakes — zero PII.
 */

import type { ApiBody } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { checkTitanBody } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/TelebankGroup/TelebankGroupShapeCheck.js';
import { titanHeaders } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/TelebankGroup/TelebankGroupShapeHelpers.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/** One Titan answer the check must refuse, and the message it gives. */
interface IRefusalRow {
  readonly title: string;
  readonly body: ApiBody;
  readonly message: string;
}

const ID_128 = 'A'.repeat(128);
const ID_129 = 'A'.repeat(129);

/**
 * A Titan accounts answer listing the given ids.
 * @param ids - Each account's `NewAccountInfo.AccountID`.
 * @returns The accounts answer.
 */
function accountsAnswer(ids: readonly unknown[]): ApiBody {
  const rows = ids.map((accountId): ApiBody => ({ NewAccountInfo: { AccountID: accountId } }));
  return { UserAccountsData: { UserAccounts: rows } };
}

/**
 * A Titan transactions answer carrying the given entries.
 * @param entries - The `OperationEntry` value.
 * @returns The transactions answer.
 */
function txnsAnswer(entries: unknown): ApiBody {
  return { CurrentAccountLastTransactions: { OperationEntry: entries } };
}

const NINE_IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
const EIGHT_IDS = NINE_IDS.slice(0, 8);

const REFUSALS: readonly IRefusalRow[] = [
  { title: 'an array body', body: [] as unknown as ApiBody, message: 'titan answer not an object' },
  { title: 'a string Error', body: { Error: 'x' }, message: 'titan answer error' },
  { title: 'an object error', body: { error: {} }, message: 'titan answer error' },
  { title: 'an empty Error', body: { Error: '' }, message: 'titan answer error' },
  {
    title: 'actionRequired false',
    body: { actionRequired: false },
    message: 'titan answer action required',
  },
  {
    title: 'actionRequired beside Error',
    body: { actionRequired: 1, Error: 'x' },
    message: 'titan answer action required',
  },
  {
    title: 'an error on an accounts answer',
    body: { ...accountsAnswer(['a']), Error: 'x' },
    message: 'titan answer error',
  },
  {
    title: 'a null accounts container',
    body: { UserAccountsData: null },
    message: 'titan accounts unverified',
  },
  {
    title: 'no account list',
    body: { UserAccountsData: {} },
    message: 'titan accounts unverified',
  },
  {
    title: 'an account list that is no array',
    body: { UserAccountsData: { UserAccounts: {} } },
    message: 'titan accounts unverified',
  },
  {
    title: 'an empty account list',
    body: accountsAnswer([]),
    message: 'titan accounts unverified',
  },
  { title: 'an empty id', body: accountsAnswer(['']), message: 'titan account ids invalid' },
  { title: 'a 129-char id', body: accountsAnswer([ID_129]), message: 'titan account ids invalid' },
  {
    title: 'an id with a space',
    body: accountsAnswer(['a b']),
    message: 'titan account ids invalid',
  },
  {
    title: 'a non-latin id',
    body: accountsAnswer(['חשבון']),
    message: 'titan account ids invalid',
  },
  { title: 'a numeric id', body: accountsAnswer([123]), message: 'titan account ids invalid' },
  {
    title: 'a duplicate id',
    body: accountsAnswer(['a', 'a']),
    message: 'titan account ids invalid',
  },
  {
    title: 'a row without NewAccountInfo',
    body: { UserAccountsData: { UserAccounts: [{ FormatAccountID: '1' }] } },
    message: 'titan account ids invalid',
  },
  {
    title: 'a row that is no record',
    body: { UserAccountsData: { UserAccounts: ['a'] } },
    message: 'titan account ids invalid',
  },
  { title: 'nine accounts', body: accountsAnswer(NINE_IDS), message: 'titan accounts over budget' },
  {
    title: 'a null transactions container',
    body: { CurrentAccountLastTransactions: null },
    message: 'titan transactions unverified',
  },
  {
    title: 'no entry list',
    body: { CurrentAccountLastTransactions: {} },
    message: 'titan transactions unverified',
  },
  {
    title: 'an entry list that is no array',
    body: txnsAnswer({}),
    message: 'titan transactions unverified',
  },
  { title: 'a numeric entry', body: txnsAnswer([1]), message: 'titan transactions unverified' },
  { title: 'a null entry', body: txnsAnswer([null]), message: 'titan transactions unverified' },
  { title: 'an array entry', body: txnsAnswer([[]]), message: 'titan transactions unverified' },
];

const PASSES: readonly (readonly [string, ApiBody])[] = [
  ['a balance answer', { AccountInfoAndBalance: { AccountBalance: 10 } }],
  ['null error fields', { Error: null, error: null, actionRequired: null, X: 1 }],
  ['one account', accountsAnswer(['ACCT_1-a'])],
  ['eight accounts', accountsAnswer(EIGHT_IDS)],
  ['a 128-char id', accountsAnswer([ID_128])],
  ['no entries', txnsAnswer([])],
  ['entries that are records', txnsAnswer([{ OperationAmount: -5 }, {}])],
  ['an answer with no known container', {}],
];

describe('checkTitanBody', () => {
  it.each(REFUSALS)('fails $title without echoing the bank text', ({ body, message }) => {
    const result = checkTitanBody(body);
    expect(result).toMatchObject({ success: false, errorType: 'GENERIC', errorMessage: message });
  });

  it.each(PASSES)('passes %s through unchanged', (_title, body) => {
    const result = checkTitanBody(body);
    expect(result).toEqual({ success: true, value: body });
  });
});

/** The routing headers every Titan call sends. */
const TITAN_ROUTING = {
  'user-agent': 'BankApiInteroperabilityResearch/1.0',
  origin: 'https://start.telebank.co.il',
  language: '@cookie:language?HEBREW',
  site: '@cookie:site?retail',
  uuid: '@cookie:tuuid?',
  'x-xsrf-token': '@cookie-strict:XSRF-TOKEN',
  businessprocessid: '',
  accept: 'application/json',
  referer: 'https://start.telebank.co.il/apollo/retail3/',
};

describe('titanHeaders', () => {
  const ctx = {} as IActionContext;

  it('sends an empty account number on a call of no account', () => {
    const headers = titanHeaders(ctx, {});
    expect(headers).toEqual({ ...TITAN_ROUTING, accountnumber: '' });
  });

  it('sends the account id on a per-account call', () => {
    const headers = titanHeaders(ctx, { accountId: 'ACCT-1' });
    expect(headers).toEqual({ ...TITAN_ROUTING, accountnumber: 'ACCT-1' });
  });
});
