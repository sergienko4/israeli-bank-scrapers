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
    const allowedKinds = new Set([
      'textContent',
      'clickableText',
      'ariaLabel',
      'labelText',
      'placeholder',
    ]);
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

  it('submit uses only text-based selector kinds', () => {
    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    const submitArr = Array.isArray(config.submit) ? config.submit : [config.submit];
    expect(submitArr.length).toBeGreaterThan(0);
    const allowedKinds = new Set(['clickableText', 'ariaLabel', 'textContent']);
    const isAllAllowed = submitArr.every(s => allowedKinds.has(s.kind));
    expect(isAllAllowed).toBe(true);
  });
});

describe('beinleumiPreAction — activateLoginArea + waitForLoginFrame', () => {
  it('clicks login button and returns Mataf frame when found', async () => {
    const matafFrame = {
      url: jest.fn().mockReturnValue('https://mataf.fibi.co.il/MatafLoginService/login'),
    };
    const loginLink = {
      last: jest.fn(),
      isVisible: jest.fn().mockResolvedValue(true),
      click: jest.fn().mockResolvedValue(undefined),
    };
    loginLink.last.mockReturnValue(loginLink);
    const page = CREATE_MOCK_PAGE({
      getByText: jest.fn().mockReturnValue(loginLink),
      waitForFunction: jest.fn().mockResolvedValue(undefined),
      frames: jest.fn().mockReturnValue([matafFrame]),
    });

    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    const frame = await config.preAction?.(page);

    expect(loginLink.click).toHaveBeenCalled();
    expect(frame).toBe(matafFrame);
  });

  it('returns undefined when no Mataf frame found after polling', async () => {
    const nonMatafFrame = {
      url: jest.fn().mockReturnValue('https://www.fibi.co.il/other'),
    };
    const loginLink = {
      last: jest.fn(),
      isVisible: jest.fn().mockResolvedValue(true),
      click: jest.fn().mockResolvedValue(undefined),
    };
    loginLink.last.mockReturnValue(loginLink);
    const page = CREATE_MOCK_PAGE({
      getByText: jest.fn().mockReturnValue(loginLink),
      waitForFunction: jest.fn().mockRejectedValue(new Error('timeout')),
      frames: jest.fn().mockReturnValue([nonMatafFrame]),
    });

    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    const frame = await config.preAction?.(page);

    expect(frame).toBeUndefined();
  });

  it('skips login button click when button is not visible', async () => {
    const matafFrame = {
      url: jest.fn().mockReturnValue('https://mataf.fibi.co.il/MatafLoginService/login'),
    };
    const loginLink = {
      last: jest.fn(),
      isVisible: jest.fn().mockResolvedValue(false),
      click: jest.fn().mockResolvedValue(undefined),
    };
    loginLink.last.mockReturnValue(loginLink);
    const page = CREATE_MOCK_PAGE({
      getByText: jest.fn().mockReturnValue(loginLink),
      waitForFunction: jest.fn().mockResolvedValue(undefined),
      frames: jest.fn().mockReturnValue([matafFrame]),
    });

    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    const frame = await config.preAction?.(page);

    expect(loginLink.click).not.toHaveBeenCalled();
    expect(frame).toBe(matafFrame);
  });

  it('returns MatafMobileApproveServlet frame for OTP', async () => {
    const approveFrame = {
      url: jest.fn().mockReturnValue('https://mataf.fibi.co.il/MatafMobileApproveServlet/otp'),
    };
    const loginLink = {
      last: jest.fn(),
      isVisible: jest.fn().mockResolvedValue(false),
      click: jest.fn(),
    };
    loginLink.last.mockReturnValue(loginLink);
    const page = CREATE_MOCK_PAGE({
      getByText: jest.fn().mockReturnValue(loginLink),
      waitForFunction: jest.fn().mockResolvedValue(undefined),
      frames: jest.fn().mockReturnValue([approveFrame]),
    });

    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    const frame = await config.preAction?.(page);

    expect(frame).toBe(approveFrame);
  });
});

describe('beinleumiPostAction', () => {
  it('completes after race resolves via getByText', async () => {
    const page = CREATE_MOCK_PAGE();
    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    await expect(config.postAction?.(page)).resolves.toBeUndefined();
  });

  it('completes even if all text and label waiters time out', async () => {
    const timeoutError = new Error('timeout');
    timeoutError.name = 'TimeoutError';
    const failLoc = {
      first: jest.fn(),
      waitFor: jest.fn().mockRejectedValue(timeoutError),
    };
    failLoc.first.mockReturnValue(failLoc);
    const page = CREATE_MOCK_PAGE({
      getByText: jest.fn().mockReturnValue(failLoc),
      getByLabel: jest.fn().mockReturnValue(failLoc),
    });
    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    await expect(config.postAction?.(page)).resolves.toBeUndefined();
  });
});
