/**
 * Yahav native shape test factories: an action context whose mediator holds a
 * BaNCS session, and synthetic BaNCS answers. Every value is fabricated, so
 * the suites carry no PII.
 */

import { jest } from '@jest/globals';

import type { IYahavAcct } from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavShapeHelpers.js';
import type {
  IApiMediator,
  SessionContext,
} from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { ApiBody } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** A security token the bank issued (fake). */
export const SEC_TOKEN = Object.freeze({
  Ver: 'SecurityToken_1.0.0',
  isArchetype: false,
  Token: [{ TokenId: 'fake-token' }],
});

/** A session after the BaNCS login, the profile and the portfolio reads. */
export const PRIMED: SessionContext = Object.freeze({
  security: SEC_TOKEN,
  csrf: 'fake-csrf',
  session: 'fake-session',
  xsrf: 'fake-xsrf',
  mag: 'ZmFrZS1tYWc=',
  portfolioId: 'fake-portfolio',
  portfolioIorId: 'fake-portfolio-ior',
});

/** The current account the accounts read returns. */
export const ACCT: IYahavAcct = { id: 'fake-account', iorId: 'fake-ior', number: 'fake-number' };

/**
 * An action context whose mediator answers with the given session.
 * @param session - Session-context snapshot.
 * @param start - Scrape-window start; a month ago when absent.
 * @returns Action context.
 */
export function yahavCtx(session: SessionContext, start?: Date): IActionContext {
  const bus = {
    getSessionContext: jest.fn((): SessionContext => session),
  } as unknown as IApiMediator;
  const base = makeMockContext();
  const startDate = start ?? new Date(Date.now() - 30 * 86_400_000);
  const options = { ...base.options, startDate };
  const withBus: IPipelineContext = { ...base, options, apiMediator: some(bus) };
  return withBus;
}

/**
 * An accepted BaNCS answer carrying the given entities.
 * @param entities - `Payload.DataEntity` members.
 * @returns Answer body.
 */
export function bancsAnswer(entities: readonly object[]): ApiBody {
  const envelope = { Ver: 'MessageEnvelope_1.0.0', Status: { Code: 0 } };
  return { ...envelope, Payload: { DataEntity: entities } };
}

/**
 * An account identifier as the bank returns it.
 * @param acct - Account it names.
 * @returns `AccountId` block.
 */
export function accountIdOf(acct: IYahavAcct): Record<string, unknown> {
  const head = { Ver: 'AccountIdentifier_1.0.0', Id: { Id: acct.id }, iorId: acct.iorId };
  return { ...head, AcctIds: { BANKACCOUNTID: acct.number } };
}

/**
 * A transaction row of an account.
 * @param acct - Account the row belongs to.
 * @param amount - Row amount text.
 * @returns Transaction row.
 */
export function txnRow(acct: IYahavAcct, amount: string): Record<string, unknown> {
  const accountId = accountIdOf(acct);
  const head = { Ver: 'Transaction_1.0.0', AccountId: accountId, Memo: 'FAKE MEMO' };
  const date = { Ver: 'Date_1.0.0', Year: 2026, Month: 6, Day: 3 };
  return { ...head, OrigDt: date, TotalCurAmt: { Amt: { Value: amount } } };
}
