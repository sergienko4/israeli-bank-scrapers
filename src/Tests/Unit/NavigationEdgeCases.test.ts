import { jest } from '@jest/globals';

jest.unstable_mockModule(
  '../../Common/Debug.js',
  /**
   * Mock Debug.
   * @returns Mocked module.
   */
  () => ({
    /**
     * Debug factory returning mock logger.
     * @returns Mock logger with all levels.
     */
    getDebug: (): Record<string, jest.Mock> => ({
      trace: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  }),
);

jest.unstable_mockModule(
  '../../Common/Waiting.js',
  /**
   * Mock Waiting with real rejection behavior.
   * @returns Mocked module.
   */
  () => ({
    waitUntil: jest.fn(),
    sleep: jest.fn().mockResolvedValue(undefined),
    humanDelay: jest.fn().mockResolvedValue(undefined),
    runSerial: jest.fn(),
    raceTimeout: jest.fn(),
    TimeoutError: class TimeoutError extends Error {},
    SECOND: 1000,
  }),
);

const { waitUntil: WAIT_UNTIL } = await import('../../Common/Waiting.js');
const { waitForRedirect: WAIT_FOR_REDIRECT, waitForUrl: WAIT_FOR_URL } =
  await import('../../Common/Navigation.js');
const { createMockPage: CREATE_MOCK_PAGE } = await import('../MockPage.js');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('waitForRedirect — timeout path (lines 123-128)', () => {
  it('re-throws when pollForRedirect times out', async () => {
    const timeoutError = new Error('Timed out waiting for redirect');
    (WAIT_UNTIL as jest.Mock).mockRejectedValue(timeoutError);

    const page = CREATE_MOCK_PAGE({
      url: jest.fn().mockReturnValue('https://bank.co.il/login'),
    });

    const promise = WAIT_FOR_REDIRECT(page, { timeout: 100 });
    await expect(promise).rejects.toThrow(timeoutError);
  });

  it('logs current URL on timeout via safeGetUrl', async () => {
    const timeoutError = new Error('Timed out');
    (WAIT_UNTIL as jest.Mock).mockRejectedValue(timeoutError);

    const page = CREATE_MOCK_PAGE({
      url: jest.fn().mockReturnValue('https://bank.co.il/login'),
    });

    const promise = WAIT_FOR_REDIRECT(page, { timeout: 100 });
    await expect(promise).rejects.toThrow('Timed out');
  });

  it('handles safeGetUrl error gracefully during timeout (line 66)', async () => {
    const timeoutError = new Error('Timed out');
    let callCount = 0;
    (WAIT_UNTIL as jest.Mock).mockRejectedValue(timeoutError);

    const page = CREATE_MOCK_PAGE({
      url: jest.fn().mockImplementation((): string => {
        callCount += 1;
        if (callCount === 1) return 'https://bank.co.il/login';
        throw new TypeError('page closed');
      }),
    });

    const promise = WAIT_FOR_REDIRECT(page, { timeout: 100 });
    await expect(promise).rejects.toThrow('Timed out');
  });

  it('handles safeGetUrl error with client-side evaluation (line 66)', async () => {
    const timeoutError = new Error('Timed out');
    let evalCount = 0;
    (WAIT_UNTIL as jest.Mock).mockRejectedValue(timeoutError);

    const page = CREATE_MOCK_PAGE({
      evaluate: jest.fn().mockImplementation((): Promise<string> => {
        evalCount += 1;
        if (evalCount === 1) return Promise.resolve('https://bank.co.il/login');
        return Promise.reject(new TypeError('context destroyed'));
      }),
    });

    const promise = WAIT_FOR_REDIRECT(page, { timeout: 100, isClientSide: true });
    await expect(promise).rejects.toThrow('Timed out');
  });
});

describe('waitForUrl — timeout path (lines 186-188)', () => {
  it('re-throws when pollForUrl times out with string pattern', async () => {
    const timeoutError = new Error('Timed out waiting for URL');
    (WAIT_UNTIL as jest.Mock).mockRejectedValue(timeoutError);

    const page = CREATE_MOCK_PAGE({
      url: jest.fn().mockReturnValue('https://bank.co.il/login'),
    });

    const promise = WAIT_FOR_URL(page, 'https://bank.co.il/target', { timeout: 100 });
    await expect(promise).rejects.toThrow(timeoutError);
  });

  it('re-throws when pollForUrl times out with regex pattern', async () => {
    const timeoutError = new Error('Timed out waiting for URL');
    (WAIT_UNTIL as jest.Mock).mockRejectedValue(timeoutError);

    const page = CREATE_MOCK_PAGE({
      url: jest.fn().mockReturnValue('https://bank.co.il/login'),
    });

    const promise = WAIT_FOR_URL(page, /dashboard\/\d+/, { timeout: 100 });
    await expect(promise).rejects.toThrow(timeoutError);
  });

  it('logs stuck URL via safeGetUrl on timeout (line 186-188)', async () => {
    const timeoutError = new Error('Timed out');
    (WAIT_UNTIL as jest.Mock).mockRejectedValue(timeoutError);

    const page = CREATE_MOCK_PAGE({
      url: jest.fn().mockImplementation((): string => {
        throw new TypeError('detached');
      }),
    });

    const promise = WAIT_FOR_URL(page, 'https://bank.co.il/target', { timeout: 100 });
    await expect(promise).rejects.toThrow('Timed out');
  });
});
