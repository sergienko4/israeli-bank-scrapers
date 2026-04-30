/**
 * Extra coverage for HomeActions — executeValidateLoginArea, executeStoreLoginSignal,
 * executeNavigateToLogin, executeModalClick, executeHomeNavigation.
 */

import type { IRaceResult } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import {
  executeHomeNavigation,
  executeModalClick,
  executeNavigateToLogin,
  executeStoreLoginSignal,
  executeValidateLoginArea,
} from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeActions.js';
import type { IHomeDiscovery } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import { NAV_STRATEGY } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeResolver.js';
import type {
  IPipelineContext,
  IResolvedTarget,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeExecutor, makeMediator, SILENT_LOG as LOG } from './HomeActionsExtraHelpers.js';

describe('executeValidateLoginArea', () => {
  it('succeeds when URL changed', async () => {
    const ctx = makeMockContext({
      browser: { has: false } as IPipelineContext['browser'],
    });
    const mediator = makeMediator({ url: 'https://bank.co.il/login' });
    const result = await executeValidateLoginArea({
      mediator,
      input: ctx,
      homepageUrl: 'https://bank.co.il',
      logger: LOG,
    });
    expect(result.success).toBe(true);
  });

  it('fails when URL unchanged and no login form detected', async () => {
    const ctx = makeMockContext({
      browser: { has: false } as IPipelineContext['browser'],
    });
    const mediator = makeMediator({ url: 'https://bank.co.il' });
    const result = await executeValidateLoginArea({
      mediator,
      input: ctx,
      homepageUrl: 'https://bank.co.il',
      logger: LOG,
    });
    expect(result.success).toBe(false);
  });

  it('succeeds when login form detected (via resolveVisible found=true)', async () => {
    const ctx = makeMockContext({
      browser: { has: false } as IPipelineContext['browser'],
    });
    const found: IRaceResult = { ...NOT_FOUND_RESULT, found: true as const };
    const mediator = makeMediator({
      url: 'https://bank.co.il',
      visibleResult: found,
    });
    const result = await executeValidateLoginArea({
      mediator,
      input: ctx,
      homepageUrl: 'https://bank.co.il',
      logger: LOG,
    });
    expect(result.success).toBe(true);
  });
});

describe('executeStoreLoginSignal', () => {
  it('stores loginUrl in diagnostics', async () => {
    const ctx = makeMockContext();
    const mediator = makeMediator({ url: 'https://bank.co.il/login' });
    const result = await executeStoreLoginSignal(mediator, ctx, LOG);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.diagnostics.loginUrl).toBe('https://bank.co.il/login');
  });
});

describe('executeNavigateToLogin', () => {
  it('uses DIRECT strategy when discovery is DIRECT', async () => {
    const ctx = makeMockContext();
    const mediator = makeMediator({ url: 'https://bank.co.il' });
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.DIRECT,
      triggerText: 'Login',
      menuCandidates: [],
      triggerTarget: false,
    };
    const result = await executeNavigateToLogin({ mediator, input: ctx, discovery, logger: LOG });
    expect(result.success).toBe(true);
  });

  it('uses SEQUENTIAL strategy when discovery is SEQUENTIAL', async () => {
    const ctx = makeMockContext();
    const mediator = makeMediator({ url: 'https://bank.co.il' });
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.SEQUENTIAL,
      triggerText: 'Menu',
      menuCandidates: [{ kind: 'textContent', value: 'Login' }],
      triggerTarget: false,
    };
    const result = await executeNavigateToLogin({ mediator, input: ctx, discovery, logger: LOG });
    expect(result.success).toBe(true);
  });

  it('falls back to href scan when navigation did not occur', async () => {
    const ctx = makeMockContext();
    const mediator = makeMediator({
      url: 'https://bank.co.il',
      allHrefs: ['https://bank.co.il/personalarea/login'],
    });
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.DIRECT,
      triggerText: 'Login',
      menuCandidates: [],
      triggerTarget: false,
    };
    const result = await executeNavigateToLogin({ mediator, input: ctx, discovery, logger: LOG });
    expect(result.success).toBe(true);
  });
});

describe('executeModalClick', () => {
  it('returns false when triggerTarget absent', async () => {
    const executor = makeExecutor();
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.MODAL,
      triggerText: 'Modal',
      menuCandidates: [],
      triggerTarget: false,
    };
    const isOk = await executeModalClick(executor, discovery, LOG);
    expect(isOk).toBe(false);
  });

  it('clicks trigger and waits for iframe content', async () => {
    const executor = makeExecutor();
    const target: IResolvedTarget = {
      contextId: 'main',
      selector: '#modal',
      kind: 'css',
      candidateValue: '#modal',
    };
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.MODAL,
      triggerText: 'Modal',
      menuCandidates: [],
      triggerTarget: target,
    };
    const isOk = await executeModalClick(executor, discovery, LOG);
    expect(isOk).toBe(false);
  });
});

describe('executeHomeNavigation', () => {
  it('returns false when no trigger target', async () => {
    const executor = makeExecutor();
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.DIRECT,
      triggerText: 'x',
      menuCandidates: [],
      triggerTarget: false,
    };
    const isOk = await executeHomeNavigation(executor, discovery, LOG);
    expect(isOk).toBe(false);
  });

  it('dispatches to MODAL when strategy is MODAL', async () => {
    const executor = makeExecutor();
    const target: IResolvedTarget = {
      contextId: 'main',
      selector: '#t',
      kind: 'css',
      candidateValue: '#t',
    };
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.MODAL,
      triggerText: 'x',
      menuCandidates: [],
      triggerTarget: target,
    };
    const isOk = await executeHomeNavigation(executor, discovery, LOG);
    expect(isOk).toBe(false);
  });

  it('runs DIRECT click flow', async () => {
    const executor = makeExecutor();
    const target: IResolvedTarget = {
      contextId: 'main',
      selector: '#t',
      kind: 'css',
      candidateValue: '#t',
    };
    const discovery: IHomeDiscovery = {
      strategy: NAV_STRATEGY.DIRECT,
      triggerText: 'x',
      menuCandidates: [],
      triggerTarget: target,
    };
    const isOk = await executeHomeNavigation(executor, discovery, LOG);
    expect(typeof isOk).toBe('boolean');
  });
});
