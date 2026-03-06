import { clickButton, fillInput } from '../../Common/ElementsInteractions';
import { maxHandleSecondLoginStep } from '../../Scrapers/Max/MaxLoginConfig';
import { createMockPage } from '../MockPage';

jest.mock('../../Common/ElementsInteractions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../Common/SelectorResolver', () => ({
  resolveFieldContext: jest
    .fn()
    .mockResolvedValue({ isResolved: true, context: {}, selector: '#sel' }),
  extractCredentialKey: jest.fn((s: string) => s),
}));
jest.mock('../../Common/Waiting', () => ({ sleep: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../Common/Debug', () => ({
  /**
   * Returns a set of jest mock functions as a debug logger stub.
   *
   * @returns a mock debug logger with debug, info, warn, and error functions
   */
  getDebug: (): Record<string, jest.Mock> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('maxHandleSecondLoginStep', () => {
  it('returns early when no id credential provided', async () => {
    const page = createMockPage();
    await maxHandleSecondLoginStep(page, { username: 'u', password: 'p' });
    expect(fillInput).not.toHaveBeenCalled();
  });

  it('returns early when id field not visible', async () => {
    const page = createMockPage({
      locator: jest.fn().mockReturnValue({ isVisible: jest.fn().mockResolvedValue(false) }),
    });
    await maxHandleSecondLoginStep(page, { username: 'u', password: 'p', id: '123456789' });
    expect(fillInput).not.toHaveBeenCalled();
  });

  it('returns early when isVisible throws (catch returns false)', async () => {
    const page = createMockPage({
      locator: jest
        .fn()
        .mockReturnValue({ isVisible: jest.fn().mockRejectedValue(new Error('err')) }),
    });
    await maxHandleSecondLoginStep(page, { username: 'u', password: 'p', id: '123456789' });
    expect(fillInput).not.toHaveBeenCalled();
  });

  it('fills second step fields when id provided and field visible', async () => {
    const page = createMockPage({
      url: jest.fn().mockReturnValue('https://www.max.co.il/'),
      locator: jest.fn().mockReturnValue({ isVisible: jest.fn().mockResolvedValue(true) }),
    });
    await maxHandleSecondLoginStep(page, {
      username: 'testuser',
      password: 'testpass',
      id: '123456789',
    });
    expect(fillInput).toHaveBeenCalled();
    expect(clickButton).toHaveBeenCalled();
  });
});
