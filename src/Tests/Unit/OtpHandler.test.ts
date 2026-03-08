import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright';

import { ScraperErrorTypes } from '../../Scrapers/Base/Errors.js';
import type { ScraperOptions } from '../../Scrapers/Base/Interface.js';

const mockExtractPhoneHint = jest.fn();
const mockClickOtpTriggerIfPresent = jest.fn();
const mockDetectOtpScreen = jest.fn();
const mockFillInput = jest.fn();
const mockClickButton = jest.fn();
const mockTryInContext = jest.fn();
const mockResolveFieldContext = jest.fn();

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  getDebug: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  waitUntil: jest.fn().mockResolvedValue(undefined),
  raceTimeout: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn().mockResolvedValue([]),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  fillInput: mockFillInput,
  clickButton: mockClickButton,
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/OtpDetector.js', () => ({
  detectOtpScreen: mockDetectOtpScreen,
  extractPhoneHint: mockExtractPhoneHint,
  clickOtpTriggerIfPresent: mockClickOtpTriggerIfPresent,
  findOtpSubmitSelector: jest.fn().mockResolvedValue(null),
  OTP_SUBMIT_CANDIDATES: [{ kind: 'xpath' as const, value: '//button[contains(.,"send")]' }],
}));

jest.unstable_mockModule('../../Common/SelectorResolver.js', () => ({
  tryInContext: mockTryInContext,
  resolveFieldContext: mockResolveFieldContext,
  candidateToCss: jest.fn((c: { value: string }) => c.value),
  extractCredentialKey: jest.fn((s: string) => s),
  toFirstCss: jest.fn(() => ''),
  resolveDashboardField: jest.fn().mockResolvedValue(null),
}));

const { handleOtpConfirm, handleOtpCode, handleOtpStep } =
  await import('../../Common/OtpHandler.js');

function makeMockPage(): Page {
  const mainFrame = {
    $: jest.fn().mockResolvedValue(null),
    url: jest.fn().mockReturnValue('https://bank.test/otp'),
    locator: jest.fn().mockReturnValue({
      first: jest.fn().mockReturnValue({
        pressSequentially: jest.fn().mockResolvedValue(undefined),
      }),
    }),
  } as unknown as Frame;

  return {
    evaluate: jest.fn().mockResolvedValue('enter OTP code'),
    frames: jest.fn().mockReturnValue([mainFrame]),
    mainFrame: jest.fn().mockReturnValue(mainFrame),
    url: jest.fn().mockReturnValue('https://bank.test/otp'),
    screenshot: jest.fn().mockResolvedValue(Buffer.from('')),
    click: jest.fn().mockResolvedValue(undefined),
    frameLocator: jest.fn().mockReturnValue({
      locator: jest.fn().mockReturnValue({
        waitFor: jest.fn().mockRejectedValue(new Error('not found')),
      }),
    }),
  } as unknown as Page;
}

function makeOptions(overrides: Partial<ScraperOptions> = {}): ScraperOptions {
  return {
    companyId: 'test',
    startDate: new Date(),
    ...overrides,
  } as ScraperOptions;
}

describe('handleOtpConfirm', () => {
  beforeEach(() => jest.clearAllMocks());

  it('extracts phone hint and clicks SMS trigger', async () => {
    mockExtractPhoneHint.mockResolvedValue('******5100');
    mockClickOtpTriggerIfPresent.mockResolvedValue(undefined);
    const page = makeMockPage();

    const hint = await handleOtpConfirm(page);

    expect(hint).toBe('******5100');
    expect(mockExtractPhoneHint).toHaveBeenCalledWith(page);
    expect(mockClickOtpTriggerIfPresent).toHaveBeenCalledWith(page);
  });

  it('returns empty string when no phone hint found', async () => {
    mockExtractPhoneHint.mockResolvedValue('');
    mockClickOtpTriggerIfPresent.mockResolvedValue(undefined);

    const hint = await handleOtpConfirm(makeMockPage());

    expect(hint).toBe('');
  });
});

describe('handleOtpCode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns TwoFactorRetrieverMissing when no otpCodeRetriever', async () => {
    const page = makeMockPage();
    const options = makeOptions();

    const result = await handleOtpCode(page, options);

    expect(result).not.toBeNull();
    expect(result?.errorType).toBe(ScraperErrorTypes.TwoFactorRetrieverMissing);
    expect(result?.success).toBe(false);
  });

  it('returns TwoFactorRetrieverMissing with screenshot path when screenshotDir set', async () => {
    const page = makeMockPage();
    const options = makeOptions({ storeFailureScreenShotPath: '/tmp/screenshots' });

    const result = await handleOtpCode(page, options);

    expect(result?.errorType).toBe(ScraperErrorTypes.TwoFactorRetrieverMissing);
    expect(result?.errorMessage).toContain('Screenshot saved to');
  });

  it('calls otpCodeRetriever with phone hint and fills code', async () => {
    const mockRetriever = jest.fn().mockResolvedValue('123456');
    mockExtractPhoneHint.mockResolvedValue('******5100');
    mockDetectOtpScreen.mockResolvedValue(false);
    mockResolveFieldContext.mockResolvedValue({
      selector: '#otpCode',
      context: makeMockPage().mainFrame(),
    });
    mockTryInContext.mockResolvedValue(null);

    const page = makeMockPage();
    const options = makeOptions({ otpCodeRetriever: mockRetriever });

    const result = await handleOtpCode(page, options, '******5100');

    expect(mockRetriever).toHaveBeenCalledWith('******5100');
    expect(result).toBeNull();
  });

  it('returns InvalidOtp when OTP screen still visible after submission', async () => {
    const mockRetriever = jest.fn().mockResolvedValue('123456').mockResolvedValue('999999');
    mockExtractPhoneHint.mockResolvedValue('');
    mockDetectOtpScreen.mockResolvedValue(true);
    mockResolveFieldContext.mockResolvedValue({
      selector: '#otpCode',
      context: makeMockPage().mainFrame(),
    });
    mockTryInContext.mockResolvedValue(null);

    const page = makeMockPage();
    const options = makeOptions({ otpCodeRetriever: mockRetriever });

    const result = await handleOtpCode(page, options);

    expect(result?.errorType).toBe(ScraperErrorTypes.InvalidOtp);
    expect(result?.success).toBe(false);
  });
});

describe('handleOtpStep', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null when no OTP screen detected', async () => {
    mockDetectOtpScreen.mockResolvedValue(false);

    const result = await handleOtpStep(makeMockPage(), makeOptions());

    expect(result).toBeNull();
    expect(mockDetectOtpScreen).toHaveBeenCalled();
  });

  it('detects OTP and calls handleOtpConfirm + handleOtpCode', async () => {
    mockDetectOtpScreen.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockExtractPhoneHint.mockResolvedValue('******5100');
    mockClickOtpTriggerIfPresent.mockResolvedValue(undefined);
    mockResolveFieldContext.mockResolvedValue({
      selector: '#otpCode',
      context: makeMockPage().mainFrame(),
    });
    mockTryInContext.mockResolvedValue(null);

    const mockRetriever = jest.fn().mockResolvedValue('123456');
    const page = makeMockPage();
    const options = makeOptions({ otpCodeRetriever: mockRetriever });

    const result = await handleOtpStep(page, options);

    expect(mockExtractPhoneHint).toHaveBeenCalled();
    expect(mockClickOtpTriggerIfPresent).toHaveBeenCalled();
    expect(mockRetriever).toHaveBeenCalledWith('******5100');
    expect(result).toBeNull();
  });

  it('returns TwoFactorRetrieverMissing when OTP detected but no retriever', async () => {
    mockDetectOtpScreen.mockResolvedValue(true);
    mockExtractPhoneHint.mockResolvedValue('');
    mockClickOtpTriggerIfPresent.mockResolvedValue(undefined);

    const result = await handleOtpStep(makeMockPage(), makeOptions());

    expect(result?.errorType).toBe(ScraperErrorTypes.TwoFactorRetrieverMissing);
  });
});
