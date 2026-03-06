import {
  getCurrentUrl,
  waitForNavigation,
  waitForNavigationAndDomLoad,
  waitForRedirect,
  waitForUrl,
} from '../../Common/Navigation';
import { createMockPage } from '../MockPage';

/**
 * Creates a mock page with the given current URL for navigation tests.
 *
 * @param currentUrl - the URL the mock page should return
 * @returns a mock page configured with the given URL
 */
function createNavMockPage(
  currentUrl = 'https://bank.co.il/login',
): ReturnType<typeof createMockPage> {
  const urlMock = jest.fn(() => currentUrl);
  const evaluateMock = jest.fn(() => Promise.resolve(currentUrl));
  const waitForUrlMock = jest.fn().mockResolvedValue(undefined);
  return createMockPage({ url: urlMock, evaluate: evaluateMock, waitForURL: waitForUrlMock });
}

describe('waitForNavigation', () => {
  it('calls page.waitForNavigation with options', async () => {
    const page = createNavMockPage();
    await waitForNavigation(page, { waitUntil: 'load' });
    expect(page.waitForURL).toHaveBeenCalledWith('**', { waitUntil: 'load' });
  });

  it('calls page.waitForNavigation without options', async () => {
    const page = createNavMockPage();
    await waitForNavigation(page);
    expect(page.waitForURL).toHaveBeenCalledWith('**', undefined);
  });
});

describe('waitForNavigationAndDomLoad', () => {
  it('waits for domcontentloaded', async () => {
    const page = createNavMockPage();
    await waitForNavigationAndDomLoad(page);
    expect(page.waitForURL).toHaveBeenCalledWith('**', { waitUntil: 'domcontentloaded' });
  });
});

describe('getCurrentUrl', () => {
  it('returns URL from page.url() when clientSide is false', () => {
    const page = createNavMockPage('https://bank.co.il/dashboard');
    const result = getCurrentUrl(page, false);
    expect(result).toBe('https://bank.co.il/dashboard');
  });

  it('returns URL from page.evaluate when clientSide is true', async () => {
    const page = createNavMockPage('https://bank.co.il/dashboard');
    const result = await getCurrentUrl(page, true);
    expect(result).toBe('https://bank.co.il/dashboard');
  });

  it('defaults to server-side URL', () => {
    const page = createNavMockPage('https://bank.co.il');
    const result = getCurrentUrl(page);
    expect(result).toBe('https://bank.co.il');
  });
});

describe('waitForRedirect', () => {
  it('resolves when URL changes', async () => {
    const page = createNavMockPage('https://bank.co.il/login');
    let callCount = 0;
    page.url = jest.fn(() => {
      callCount += 1;
      return callCount > 2 ? 'https://bank.co.il/dashboard' : 'https://bank.co.il/login';
    });
    await waitForRedirect(page, { timeout: 5000, ignoreList: [] });
    expect(callCount).toBeGreaterThan(2);
    expect(page.url).toHaveBeenCalled();
  });

  it('skips URLs in ignoreList before resolving', async () => {
    const page = createNavMockPage('https://bank.co.il/login');
    let callCount = 0;
    page.url = jest.fn(() => {
      callCount += 1;
      if (callCount <= 2) return 'https://bank.co.il/login';
      if (callCount <= 4) return 'https://bank.co.il/ignore';
      return 'https://bank.co.il/dashboard';
    });
    await waitForRedirect(page, { timeout: 5000, ignoreList: ['https://bank.co.il/ignore'] });
    expect(callCount).toBeGreaterThan(4);
  });
});

describe('waitForUrl', () => {
  it('resolves when URL matches string', async () => {
    const page = createNavMockPage();
    let callCount = 0;
    page.url = jest.fn(() => {
      callCount += 1;
      return callCount > 1 ? 'https://bank.co.il/target' : 'https://bank.co.il/login';
    });
    await waitForUrl(page, 'https://bank.co.il/target', { timeout: 5000 });
    expect(callCount).toBeGreaterThan(1);
  });

  it('resolves when URL matches regex', async () => {
    const page = createNavMockPage();
    let callCount = 0;
    page.url = jest.fn(() => {
      callCount += 1;
      return callCount > 1 ? 'https://bank.co.il/dashboard/123' : 'https://bank.co.il/login';
    });
    await waitForUrl(page, /dashboard\/\d+/, { timeout: 5000 });
    expect(callCount).toBeGreaterThan(1);
  });

  it('throws TimeoutError when URL never matches', async () => {
    const page = createNavMockPage();
    page.url = jest.fn().mockReturnValue('https://bank.co.il/login');
    const urlPromise = waitForUrl(page, /never-matches/, { timeout: 80 });
    await expect(urlPromise).rejects.toThrow();
  });
});

describe('waitForRedirect timeout', () => {
  it('throws when URL never changes within timeout', async () => {
    const page = createNavMockPage();
    page.url = jest.fn().mockReturnValue('https://bank.co.il/login');
    const redirectPromise = waitForRedirect(page, { timeout: 80 });
    await expect(redirectPromise).rejects.toThrow();
  });
});
