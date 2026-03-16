import { jest } from '@jest/globals';

import { LEUMI_LOGIN_URL } from '../TestConstants.js';

/**
 * Build a locator mock that returns a login URL from evaluate.
 * @param accountIds - Account IDs for allInnerTexts().
 * @returns A mock locator chain.
 */
export default function buildLocatorMock(accountIds: string[] = []): jest.Mock {
  const firstObj = {
    evaluate: jest.fn().mockResolvedValue(LEUMI_LOGIN_URL),
    waitFor: jest.fn().mockResolvedValue(undefined),
    click: jest.fn().mockResolvedValue(undefined),
    innerText: jest.fn().mockResolvedValue(''),
    count: jest.fn().mockResolvedValue(1),
    getAttribute: jest.fn().mockResolvedValue(undefined),
  };
  return jest.fn().mockReturnValue({
    first: jest.fn().mockReturnValue(firstObj),
    count: jest.fn().mockResolvedValue(1),
    all: jest.fn().mockResolvedValue([]),
    allInnerTexts: jest.fn().mockResolvedValue(accountIds),
  });
}
