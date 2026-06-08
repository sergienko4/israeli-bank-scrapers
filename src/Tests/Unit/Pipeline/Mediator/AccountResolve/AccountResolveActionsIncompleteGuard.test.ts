/**
 * Phase 7b — ACCOUNT-RESOLVE.POST `ACCOUNT_RESOLUTION_INCOMPLETE`
 * fail-loud guard.
 *
 * Contract: if the resolved id count is less than the maximum
 * container size seen anywhere in the pool, POST halts the run with
 * `ACCOUNT_RESOLUTION_INCOMPLETE`. Prevents silent data loss when the
 * picker mistakenly returns a partial-list endpoint while a fuller
 * one is also in the pool.
 */

import { executeAccountResolvePost } from '../../../../../Scrapers/Pipeline/Mediator/AccountResolve/AccountResolveActions.js';
import type { IElementMediator } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** Args for `makeCapture`. */
interface IMakeCaptureArgs {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly responseBody: unknown;
  readonly captureIndex?: number;
}

/**
 * Builds a synthetic discovered endpoint.
 * @param args - Capture args.
 * @returns Synthetic IDiscoveredEndpoint.
 */
function makeCapture(args: IMakeCaptureArgs): IDiscoveredEndpoint {
  return {
    url: args.url,
    method: args.method,
    postData: '',
    responseBody: args.responseBody,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 100,
    captureIndex: args.captureIndex ?? 0,
  };
}

/**
 * Builds a mediator stub whose pre-nav pool exposes the supplied captures.
 * @param captures - Pool to expose.
 * @returns Stub IElementMediator.
 */
function makePoolMediator(captures: readonly IDiscoveredEndpoint[]): IElementMediator {
  return {
    network: {
      /**
       * Returns the configured pool.
       * @returns Pre-nav captures.
       */
      getPreNavCaptures: (): readonly IDiscoveredEndpoint[] => captures,
    },
  } as unknown as IElementMediator;
}

describe('ACCOUNT-RESOLVE.POST — ACCOUNT_RESOLUTION_INCOMPLETE guard (Phase 7b)', () => {
  it('VisaCal pattern: pool has cards:[2]+bankAccounts:[2] in same body → resolves all 4', async () => {
    const accountInit = makeCapture({
      url: 'https://api.cal-online.example/Authentication/api/account/init',
      method: 'POST',
      captureIndex: 25,
      responseBody: {
        result: {
          cards: [
            { cardUniqueId: 'FAKE-VC-CARD-1', last4Digits: '1111' },
            { cardUniqueId: 'FAKE-VC-CARD-2', last4Digits: '2222' },
          ],
          bankAccounts: [
            { bankAccountUniqueId: 'FAKE-VC-BANK-1', bankAccountNum: '0001111' },
            { bankAccountUniqueId: 'FAKE-VC-BANK-2', bankAccountNum: '0002222' },
          ],
        },
      },
    });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: makePoolMediator([accountInit]) },
    } as IPipelineContext;
    const result = await executeAccountResolvePost(ctx);
    const wasOk = isOk(result);
    expect(wasOk).toBe(true);
    if (isOk(result) && result.value.accountDiscovery.has) {
      const ad = result.value.accountDiscovery.value;
      expect(ad.ids.length).toBe(4);
      const keys = Object.keys(ad.containers);
      keys.sort((a, b): number => a.localeCompare(b));
      expect(keys).toEqual(['bankAccounts', 'cards']);
    }
  });

  it('Amex pattern: pool has 1-card AND 8-card containers → resolves all 8 ids', async () => {
    const directDebit = makeCapture({
      url: 'https://web.americanexpress.example/ocp/.../GetDirectDebitList',
      method: 'GET',
      captureIndex: 162,
      responseBody: { data: { cards: [{ cardNumber: '8912' }] } },
    });
    const cardList = makeCapture({
      url: 'https://web.americanexpress.example/ocp/.../GetCardList',
      method: 'POST',
      captureIndex: 163,
      responseBody: {
        data: {
          cardsList: [
            { cardSuffix: '8912', accountNumber: '228812' },
            { cardSuffix: '9921', accountNumber: '248480' },
            { cardSuffix: '0786', accountNumber: '203489' },
            { cardSuffix: '1314', accountNumber: '228812' },
            { cardSuffix: '6440', accountNumber: '515331' },
            { cardSuffix: '5290', accountNumber: '228812' },
            { cardSuffix: '5167', accountNumber: '190691' },
            { cardSuffix: '0734', accountNumber: '66028' },
          ],
        },
      },
    });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: makePoolMediator([directDebit, cardList]) },
    } as IPipelineContext;
    const result = await executeAccountResolvePost(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    if (isOk(result)) {
      expect(result.value.accountDiscovery.has).toBe(true);
      if (result.value.accountDiscovery.has) {
        expect(result.value.accountDiscovery.value.ids.length).toBe(8);
      }
    }
  });

  it('Isracard pattern: 3-card AND 8-card containers → resolves all 8 ids', async () => {
    const directDebit = makeCapture({
      url: 'https://web.isracard.example/ocp/.../GetDirectDebitList',
      method: 'GET',
      captureIndex: 187,
      responseBody: {
        data: {
          cards: [{ cardNumber: '5290' }, { cardNumber: '5167' }, { cardNumber: '1314' }],
        },
      },
    });
    const cardList = makeCapture({
      url: 'https://web.isracard.example/ocp/.../GetCardList',
      method: 'POST',
      captureIndex: 188,
      responseBody: {
        data: {
          cardsList: [
            { cardSuffix: '0786', accountNumber: '203489' },
            { cardSuffix: '1314', accountNumber: '228812' },
            { cardSuffix: '6440', accountNumber: '515331' },
            { cardSuffix: '5290', accountNumber: '228812' },
            { cardSuffix: '5167', accountNumber: '190691' },
            { cardSuffix: '0734', accountNumber: '66028' },
            { cardSuffix: '8912', accountNumber: '228812' },
            { cardSuffix: '9921', accountNumber: '248480' },
          ],
        },
      },
    });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: makePoolMediator([directDebit, cardList]) },
    } as IPipelineContext;
    const result = await executeAccountResolvePost(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    if (isOk(result)) {
      expect(result.value.accountDiscovery.has).toBe(true);
      if (result.value.accountDiscovery.has) {
        expect(result.value.accountDiscovery.value.ids.length).toBe(8);
      }
    }
  });

  it('Hapoalim shape: pool has root-array but ZERO named containers → maxSeen=0, commits 1 id (no false-positive incomplete)', async () => {
    const accounts = makeCapture({
      url: 'https://login.hapoalim.example/ServerServices/general/accounts',
      method: 'GET',
      responseBody: [
        { bankNumber: 12, branchNumber: 170, accountNumber: 991234, productLabel: '99-999-991234' },
      ],
    });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: makePoolMediator([accounts]) },
    } as IPipelineContext;
    const result = await executeAccountResolvePost(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    if (isOk(result)) {
      expect(result.value.accountDiscovery.has).toBe(true);
      if (result.value.accountDiscovery.has) {
        expect(result.value.accountDiscovery.value.ids).toContain('991234');
      }
    }
  });

  it('single-container bank (Discount): maxSeen=1, resolved=1 → commits successfully', async () => {
    const userAccountsData = makeCapture({
      url: 'https://api.discount.example/userAccountsData',
      method: 'GET',
      responseBody: {
        UserAccountsData: {
          UserAccounts: [
            {
              NewAccountInfo: { BankID: '0011', AccountID: 'fake-acct-A' },
              FormatAccountID: '99-999-FAKE',
            },
          ],
        },
      },
    });
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: makePoolMediator([userAccountsData]) },
    } as IPipelineContext;
    const result = await executeAccountResolvePost(ctx);
    const isResultOk = isOk(result);
    expect(isResultOk).toBe(true);
    if (isOk(result) && result.value.accountDiscovery.has) {
      expect(result.value.accountDiscovery.value.ids.length).toBeGreaterThan(0);
    }
  });

  it('empty pool → fails loud with ACCOUNT_RESOLUTION_FAILED (existing behavior)', async () => {
    const baseCtx = makeMockContext();
    const ctx = {
      ...baseCtx,
      mediator: { has: true, value: makePoolMediator([]) },
    } as IPipelineContext;
    const result = await executeAccountResolvePost(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('ACCOUNT_RESOLUTION_FAILED');
    }
  });
});
