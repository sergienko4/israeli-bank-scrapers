/**
 * Unit tests for DashboardNavigation — triggerOrganicDashboard.
 */

import { triggerOrganicDashboard } from '../../../../Scrapers/Pipeline/Mediator/Dashboard/DashboardNavigation.js';
import type { IRaceResult } from '../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockMediator } from '../../Scrapers/Pipeline/MockPipelineFactories.js';

/** Found race result for date filter. */
const FOUND_DATE: IRaceResult = {
  found: true,
  locator: false,
  candidate: { kind: 'textContent', value: 'From' },
  context: {} as unknown as IRaceResult['context'],
  index: 0,
  value: 'From',
  identity: false,
};

describe('triggerOrganicDashboard', () => {
  it('returns succeed when empty targetUrl and no fallback hrefs', async () => {
    const mediator = makeMockMediator();
    const result = await triggerOrganicDashboard(mediator, '');
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });

  it('navigates to the provided targetUrl', async () => {
    let navigated = '';
    const mediator = makeMockMediator({
      /**
       * Record URL + succeed.
       * @param url - Target URL.
       * @returns Succeed.
       */
      navigateTo: url => {
        navigated = url;
        return Promise.resolve({ success: true, value: undefined });
      },
    });
    const result = await triggerOrganicDashboard(mediator, 'https://bank.example.com/txns');
    expect(navigated).toBe('https://bank.example.com/txns');
    const isOkResult2 = isOk(result);
    expect(isOkResult2).toBe(true);
  });

  it('triggers date filter when filter probes succeed', async () => {
    const mediator = makeMockMediator({
      /**
       * Return found result for date elements.
       * @returns Found.
       */
      resolveVisible: () => Promise.resolve(FOUND_DATE),
    });
    const result = await triggerOrganicDashboard(mediator, 'https://bank.example.com/txns');
    const isOkResult3 = isOk(result);
    expect(isOkResult3).toBe(true);
  });

  it('continues when navigateTo rejects (catch and proceed)', async () => {
    const mediator = makeMockMediator({
      /**
       * Rejects navigation.
       * @returns Rejected.
       */
      navigateTo: () => Promise.reject(new Error('network')),
    });
    const result = await triggerOrganicDashboard(mediator, 'https://bank.example.com/txns');
    const isOkResult4 = isOk(result);
    expect(isOkResult4).toBe(true);
  });

  it('extracts fallback url from hrefs when targetUrl empty', async () => {
    const mediator = makeMockMediator({
      /**
       * Provide one href containing transactions.
       * @returns Array of hrefs.
       */
      collectAllHrefs: () => Promise.resolve(['https://bank.example.com/transactions']),
      /**
       * Report current URL on the bank origin so href resolves absolutely.
       * @returns URL string.
       */
      getCurrentUrl: () => 'https://bank.example.com/dashboard',
    });
    const result = await triggerOrganicDashboard(mediator, '');
    const isOkResult5 = isOk(result);
    expect(isOkResult5).toBe(true);
  });

  it('swallows waitForNetworkIdle rejection via safeNavigate catch', async () => {
    const mediator = makeMockMediator({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForNetworkIdle: () => Promise.reject(new Error('idle fail')),
    });
    const result = await triggerOrganicDashboard(mediator, 'https://bank.example.com/txns');
    const isOkResult6 = isOk(result);
    expect(isOkResult6).toBe(true);
  });

  it('date-filter path swallows resolveField + waitForNetworkIdle rejections', async () => {
    const mediator = makeMockMediator({
      /**
       * Test helper.
       *
       * @returns Result.
       */
      resolveVisible: () => Promise.resolve(FOUND_DATE),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      resolveField: () => Promise.reject(new Error('field fail')),
      /**
       * Test helper.
       *
       * @returns Result.
       */
      waitForNetworkIdle: () => Promise.reject(new Error('idle fail')),
    });
    const result = await triggerOrganicDashboard(mediator, 'https://bank.example.com/txns');
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
  });
});
