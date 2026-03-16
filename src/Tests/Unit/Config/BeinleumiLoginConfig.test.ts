import { jest } from '@jest/globals';

jest.unstable_mockModule(
  '../../../Common/ElementsInteractions.js',
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

const { beinleumiConfig: BEINLEUMI_CONFIG, BEINLEUMI_FIELDS } =
  await import('../../../Scrapers/BaseBeinleumiGroup/Config/BeinleumiLoginConfig.js');
const { createMockPage: CREATE_MOCK_PAGE } = await import('../../MockPage.js');

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

  it('has otp config with kind dom and triggerSelectors', () => {
    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    expect(config.otp).toBeDefined();
    expect(config.otp?.kind).toBe('dom');
  });

  it('otp triggerSelectors use only text-based kinds', () => {
    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    const otp = config.otp;
    expect(otp?.kind).toBe('dom');
    if (otp?.kind !== 'dom') return;
    const triggers = otp.triggerSelectors ?? [];
    expect(triggers.length).toBeGreaterThan(0);
    const allowedKinds = new Set(['textContent', 'ariaLabel', 'labelText', 'placeholder']);
    const isAllAllowed = triggers.every(s => allowedKinds.has(s.kind));
    expect(isAllAllowed).toBe(true);
  });

  it('otp inputSelectors and submitSelectors are defined', () => {
    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    const otp = config.otp;
    expect(otp?.kind).toBe('dom');
    if (otp?.kind !== 'dom') return;
    expect(otp.inputSelectors.length).toBeGreaterThan(0);
    expect(otp.submitSelectors.length).toBeGreaterThan(0);
  });

  it('submit field is empty — wellKnown __submit__ handles it', () => {
    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    expect(config.submit).toEqual([]);
  });
});

describe('beinleumiPreAction — text-based login trigger detection', () => {
  it('clicks trigger and returns login iframe when trigger text is visible', async () => {
    const loginFrame = {
      url: jest.fn().mockReturnValue('https://www.fibi.co.il/login'),
    };
    const visibleLoc = {
      first: jest.fn(),
      isVisible: jest.fn().mockResolvedValue(true),
      click: jest.fn().mockResolvedValue(undefined),
    };
    visibleLoc.first.mockReturnValue(visibleLoc);
    const page = CREATE_MOCK_PAGE({
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      frames: jest.fn().mockReturnValue([loginFrame]),
      getByText: jest.fn().mockReturnValue(visibleLoc),
    });

    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    const frame = await config.preAction?.(page);

    expect(page.getByText).toHaveBeenCalled();
    expect(visibleLoc.click).toHaveBeenCalled();
    expect(page.waitForTimeout).toHaveBeenCalledWith(2000);
    expect(frame).toBe(loginFrame);
  });

  it('returns undefined when trigger visible but no login iframe found', async () => {
    const nonLoginFrame = {
      url: jest.fn().mockReturnValue('https://www.fibi.co.il/other'),
    };
    const visibleLoc = {
      first: jest.fn(),
      isVisible: jest.fn().mockResolvedValue(true),
      click: jest.fn().mockResolvedValue(undefined),
    };
    visibleLoc.first.mockReturnValue(visibleLoc);
    const page = CREATE_MOCK_PAGE({
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      frames: jest.fn().mockReturnValue([nonLoginFrame]),
      getByText: jest.fn().mockReturnValue(visibleLoc),
    });

    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    const frame = await config.preAction?.(page);

    expect(page.waitForTimeout).toHaveBeenCalledWith(2000);
    expect(frame).toBeUndefined();
  });

  it('waits 1000ms when no login trigger text is visible', async () => {
    const loginFrame = {
      url: jest.fn().mockReturnValue('https://www.fibi.co.il/login'),
    };
    const page = CREATE_MOCK_PAGE({
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
      frames: jest.fn().mockReturnValue([loginFrame]),
    });

    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    const frame = await config.preAction?.(page);

    expect(page.waitForTimeout).toHaveBeenCalledWith(1000);
    expect(frame).toBe(loginFrame);
  });
});

describe('beinleumiPostAction', () => {
  it('completes after race resolves via getByText', async () => {
    const page = CREATE_MOCK_PAGE();
    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    await expect(config.postAction?.(page)).resolves.toBeUndefined();
  });

  it('completes even if all text waiters time out', async () => {
    const failLoc = {
      first: jest.fn(),
      waitFor: jest.fn().mockRejectedValue(new Error('timeout')),
    };
    failLoc.first.mockReturnValue(failLoc);
    const page = CREATE_MOCK_PAGE({
      getByText: jest.fn().mockReturnValue(failLoc),
    });
    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    await expect(config.postAction?.(page)).resolves.toBeUndefined();
  });
});
