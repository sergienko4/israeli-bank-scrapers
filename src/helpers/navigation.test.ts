import {
  waitForNavigation,
  waitForNavigationAndDomLoad,
  getCurrentUrl,
  waitForRedirect,
  waitForUrl,
} from './navigation';
import { createMockPage } from '../tests/mock-page';

function createNavMockPage(currentUrl = 'https://bank.co.il/login') {
  const urlMock = jest.fn(() => currentUrl);
  const evaluateMock = jest.fn(() => Promise.resolve(currentUrl));
  return createMockPage({ url: urlMock, evaluate: evaluateMock });
}

describe('waitForNavigation', () => {
  it('calls page.waitForNavigation with options', async () => {
    const page = createNavMockPage();
    await waitForNavigation(page, { waitUntil: 'load' });
    expect(page.waitForNavigation).toHaveBeenCalledWith({ waitUntil: 'load' });
  });

  it('calls page.waitForNavigation without options', async () => {
    const page = createNavMockPage();
    await waitForNavigation(page);
    expect(page.waitForNavigation).toHaveBeenCalledWith(undefined);
  });
});

describe('waitForNavigationAndDomLoad', () => {
  it('waits for domcontentloaded', async () => {
    const page = createNavMockPage();
    await waitForNavigationAndDomLoad(page);
    expect(page.waitForNavigation).toHaveBeenCalledWith({ waitUntil: 'domcontentloaded' });
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
    await waitForRedirect(page, 5000, false, []);
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
    await waitForRedirect(page, 5000, false, ['https://bank.co.il/ignore']);
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
    await waitForUrl(page, 'https://bank.co.il/target', 5000, false);
    expect(callCount).toBeGreaterThan(1);
  });

  it('resolves when URL matches regex', async () => {
    const page = createNavMockPage();
    let callCount = 0;
    page.url = jest.fn(() => {
      callCount += 1;
      return callCount > 1 ? 'https://bank.co.il/dashboard/123' : 'https://bank.co.il/login';
    });
    await waitForUrl(page, /dashboard\/\d+/, 5000, false);
    expect(callCount).toBeGreaterThan(1);
  });
});
