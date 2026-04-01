/**
 * Unit tests for PipelineLoginConfig — type guard + postActionWithCtx credential flow.
 * Tests hasPipelinePostAction guard and postActionWithCtx credential flow.
 */

import type { Page } from 'playwright-core';

import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import type { IElementMediator } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { IPipelineLoginConfig } from '../../../../Scrapers/Pipeline/Types/PipelineLoginConfig.js';
import { hasPipelinePostAction } from '../../../../Scrapers/Pipeline/Types/PipelineLoginConfig.js';
import { makeMockContext } from './MockFactories.js';

/**
 * Build a plain ILoginConfig without postActionWithCtx.
 * @returns ILoginConfig for testing.
 */
function makePlainConfig(): ILoginConfig {
  const config = {
    loginUrl: 'https://example.com',
    fields: [],
    submit: [],
    possibleResults: {},
  } as unknown as ILoginConfig;
  return config;
}

describe('hasPipelinePostAction', () => {
  it('returns false for plain ILoginConfig without postActionWithCtx', () => {
    const config = makePlainConfig();
    const hasCtxAction = hasPipelinePostAction(config);
    expect(hasCtxAction).toBe(false);
  });

  it('returns false when postActionWithCtx is not a function', () => {
    const config = {
      loginUrl: 'https://example.com',
      fields: [],
      submit: [],
      possibleResults: {},
      postActionWithCtx: 'not-a-function',
    } as unknown as ILoginConfig;
    const hasCtxAction = hasPipelinePostAction(config);
    expect(hasCtxAction).toBe(false);
  });

  it('returns true when postActionWithCtx is a function', () => {
    /**
     * Stub postActionWithCtx.
     * @returns Resolved true.
     */
    const stub = (): Promise<boolean> => Promise.resolve(true);
    const config = {
      loginUrl: 'https://example.com',
      fields: [],
      submit: [],
      possibleResults: {},
      postActionWithCtx: stub,
    } as unknown as IPipelineLoginConfig;
    const hasCtxAction = hasPipelinePostAction(config);
    expect(hasCtxAction).toBe(true);
  });

  it('returns true even when postAction is also present', () => {
    /**
     * Stub postAction.
     * @returns Resolved true.
     */
    const stubPost = (): Promise<boolean> => Promise.resolve(true);
    /**
     * Stub postActionWithCtx.
     * @returns Resolved true.
     */
    const stubCtx = (): Promise<boolean> => Promise.resolve(true);
    const config = {
      loginUrl: 'https://example.com',
      fields: [],
      submit: [],
      possibleResults: {},
      postAction: stubPost,
      postActionWithCtx: stubCtx,
    } as unknown as IPipelineLoginConfig;
    const hasCtxAction = hasPipelinePostAction(config);
    expect(hasCtxAction).toBe(true);
  });
});

describe('postActionWithCtx credential flow', () => {
  it('receives credentials from pipeline context', async () => {
    let hasReceivedCredentials = false;
    let capturedId = '';

    /**
     * Capture credentials from pipeline context.
     * @param _page - Unused page.
     * @param ctx - Pipeline context with credentials.
     * @returns True after capturing.
     */
    const captureCredentials = (_page: Page, ctx: IPipelineContext): Promise<boolean> => {
      const creds = ctx.credentials as Record<string, string>;
      capturedId = creds.id;
      hasReceivedCredentials = capturedId.length > 0;
      return Promise.resolve(true);
    };

    const config = {
      loginUrl: 'https://example.com',
      fields: [],
      submit: [],
      possibleResults: {},
      postActionWithCtx: captureCredentials,
    } as unknown as IPipelineLoginConfig;

    const ctx = makeMockContext({
      credentials: { username: 'testUser', password: 'testP', id: '123456789' },
    });
    const mockPage = {} as unknown as Page;

    if (hasPipelinePostAction(config) && config.postActionWithCtx) {
      await config.postActionWithCtx(mockPage, ctx);
    }

    expect(hasReceivedCredentials).toBe(true);
    expect(capturedId).toBe('123456789');
  });

  it('receives mediator from pipeline context', async () => {
    let hasReceivedMediator = false;

    /**
     * Capture mediator presence from pipeline context.
     * @param _page - Unused page.
     * @param ctx - Pipeline context with mediator.
     * @returns True after capturing.
     */
    const captureMediator = (_page: Page, ctx: IPipelineContext): Promise<boolean> => {
      hasReceivedMediator = ctx.mediator.has;
      return Promise.resolve(true);
    };

    const config = {
      loginUrl: 'https://example.com',
      fields: [],
      submit: [],
      possibleResults: {},
      postActionWithCtx: captureMediator,
    } as unknown as IPipelineLoginConfig;

    const mockMediator = {} as unknown as IElementMediator;
    const ctx = makeMockContext({ mediator: some(mockMediator) });
    const mockPage = {} as unknown as Page;

    if (hasPipelinePostAction(config) && config.postActionWithCtx) {
      await config.postActionWithCtx(mockPage, ctx);
    }

    expect(hasReceivedMediator).toBe(true);
  });
});
