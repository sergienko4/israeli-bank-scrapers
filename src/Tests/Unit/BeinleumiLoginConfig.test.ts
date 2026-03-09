import { jest } from '@jest/globals';

jest.unstable_mockModule(
  '../../Common/ElementsInteractions.js',
  /**
   * Mock ElementsInteractions.
   * @returns Mocked module.
   */
  () => ({
    elementPresentOnPage: jest.fn(),
    clickButton: jest.fn().mockResolvedValue(undefined),
    fillInput: jest.fn().mockResolvedValue(undefined),
    waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
    capturePageText: jest.fn().mockResolvedValue(''),
    pageEvalAll: jest.fn().mockResolvedValue([]),
    pageEval: jest.fn().mockResolvedValue(null),
  }),
);

const { elementPresentOnPage: ELEMENT_PRESENT } =
  await import('../../Common/ElementsInteractions.js');
const { beinleumiConfig: BEINLEUMI_CONFIG, BEINLEUMI_FIELDS } =
  await import('../../Scrapers/BaseBeinleumiGroup/BeinleumiLoginConfig.js');
const { createMockPage: CREATE_MOCK_PAGE } = await import('../MockPage.js');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('beinleumiConfig', () => {
  it('returns config with the given loginUrl', () => {
    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    expect(config.loginUrl).toBe('https://www.fibi.co.il');
  });

  it('includes the BEINLEUMI_FIELDS in fields', () => {
    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    expect(config.fields).toBe(BEINLEUMI_FIELDS);
  });

  it('has preAction and postAction defined', () => {
    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    expect(config.preAction).toBeDefined();
    expect(config.postAction).toBeDefined();
  });
});

describe('beinleumiPreAction — trigger panel logic (lines 50-56)', () => {
  it('clicks trigger and returns login iframe when trigger is present', async () => {
    const loginFrame = {
      url: jest.fn().mockReturnValue('https://www.fibi.co.il/login'),
    };
    const page = CREATE_MOCK_PAGE({
      evaluate: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      frames: jest.fn().mockReturnValue([loginFrame]),
    });
    (ELEMENT_PRESENT as jest.Mock).mockResolvedValue(true);

    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    const frame = await config.preAction?.(page);

    expect(ELEMENT_PRESENT).toHaveBeenCalledWith(page, 'a.login-trigger');
    expect(page.evaluate).toHaveBeenCalled();
    expect(page.waitForTimeout).toHaveBeenCalledWith(2000);
    expect(frame).toBe(loginFrame);
  });

  it('returns undefined when trigger present but no login iframe found', async () => {
    const nonLoginFrame = {
      url: jest.fn().mockReturnValue('https://www.fibi.co.il/other'),
    };
    const page = CREATE_MOCK_PAGE({
      evaluate: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      frames: jest.fn().mockReturnValue([nonLoginFrame]),
    });
    (ELEMENT_PRESENT as jest.Mock).mockResolvedValue(true);

    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    const frame = await config.preAction?.(page);

    expect(page.waitForTimeout).toHaveBeenCalledWith(2000);
    expect(frame).toBeUndefined();
  });

  it('skips trigger click when no trigger present and waits 1000ms', async () => {
    const loginFrame = {
      url: jest.fn().mockReturnValue('https://www.fibi.co.il/login'),
    };
    const page = CREATE_MOCK_PAGE({
      evaluate: jest.fn().mockResolvedValue(undefined),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      frames: jest.fn().mockReturnValue([loginFrame]),
    });
    (ELEMENT_PRESENT as jest.Mock).mockResolvedValue(false);

    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    const frame = await config.preAction?.(page);

    expect(page.evaluate).not.toHaveBeenCalled();
    expect(page.waitForTimeout).toHaveBeenCalledWith(1000);
    expect(frame).toBe(loginFrame);
  });
});

describe('beinleumiPostAction', () => {
  it('completes after race resolves', async () => {
    const page = CREATE_MOCK_PAGE({
      waitForSelector: jest.fn().mockResolvedValue(undefined),
    });
    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    await expect(config.postAction?.(page)).resolves.toBeUndefined();
  });

  it('completes even if all selectors time out', async () => {
    const page = CREATE_MOCK_PAGE({
      waitForSelector: jest.fn().mockRejectedValue(new Error('timeout')),
    });
    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    await expect(config.postAction?.(page)).resolves.toBeUndefined();
  });
});
