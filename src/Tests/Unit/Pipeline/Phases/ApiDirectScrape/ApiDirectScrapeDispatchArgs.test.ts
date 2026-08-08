/**
 * Edge coverage for ApiDirectScrapeDispatchArgs URL-tag resolvers that
 * the full-phase integration test cannot naturally reach: the optional
 * customer secondary-identity producer (declared only by a couple of
 * banks) and the balance-step producer form. Minimal driver contexts are
 * cast in because these resolvers read only the shape's urlTag slots.
 */

import {
  buildBalanceDispatchArgs,
  type IAcctCtx,
  type IDriverCtx,
  resolveSecondaryUrlTag,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeDispatchArgs.js';

/**
 * Producer form of a customer secondary-identity urlTag.
 * @returns Secondary-identity urlTag path.
 */
function secondaryProducer(): string {
  return 'data.customerSecondary';
}

/**
 * Producer form of a balance-step urlTag.
 * @returns Balance urlTag path.
 */
function balanceUrlTag(): string {
  return 'data.sync';
}

/**
 * Empty balance query variables.
 * @returns Empty variables object.
 */
function balanceVars(): object {
  return {};
}

/**
 * Build a driver context whose customer step declares the given
 * secondary-identity urlTag spec.
 * @param secondaryUrlTag - Producer, literal, or undefined.
 * @returns Cast driver context.
 */
function driverWithSecondary(secondaryUrlTag: unknown): IDriverCtx<unknown, unknown> {
  const shape = { customer: { secondaryUrlTag } };
  return { shape, bus: {}, ctx: {} } as unknown as IDriverCtx<unknown, unknown>;
}

/**
 * Build a per-account context whose balance step resolves its urlTag via
 * a producer function.
 * @returns Cast per-account context.
 */
function acctWithBalanceProducer(): IAcctCtx<unknown, unknown> {
  const balance = { urlTag: balanceUrlTag, buildVars: balanceVars };
  const shape = { balance, signer: false, secrets: undefined };
  return { shape, bus: {}, ctx: {}, acct: {} } as unknown as IAcctCtx<unknown, unknown>;
}

describe('ApiDirectScrapeDispatchArgs.resolveSecondaryUrlTag (edge)', () => {
  it('returns false when the shape declares no secondary fetch', () => {
    const driver = driverWithSecondary(undefined);
    const resolved = resolveSecondaryUrlTag(driver);
    expect(resolved).toBe(false);
  });

  it('invokes a producer secondary urlTag with the action context', () => {
    const driver = driverWithSecondary(secondaryProducer);
    const resolved = resolveSecondaryUrlTag(driver);
    expect(resolved).toBe('data.customerSecondary');
  });

  it('passes a literal secondary urlTag through unchanged', () => {
    const driver = driverWithSecondary('data.customerSecondary');
    const resolved = resolveSecondaryUrlTag(driver);
    expect(resolved).toBe('data.customerSecondary');
  });
});

describe('ApiDirectScrapeDispatchArgs.buildBalanceDispatchArgs (edge)', () => {
  it('resolves a producer balance urlTag from the account', () => {
    const acct = acctWithBalanceProducer();
    const args = buildBalanceDispatchArgs(acct);
    expect(args.urlTag).toBe('data.sync');
    expect(args.queryTag).toBe('balance');
  });
});
