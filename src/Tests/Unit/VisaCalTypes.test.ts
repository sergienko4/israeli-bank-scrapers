import {
  authModuleOrUndefined,
  isAuthModule,
  isCardPendingTransactionDetails,
  isCardTransactionDetails,
  isPending,
} from '../../Scrapers/VisaCal/VisaCalTypes.js';

describe('isAuthModule', () => {
  it('returns true for valid auth module with non-empty token', () => {
    const isValid = isAuthModule({ auth: { calConnectToken: 'valid-token-123' } });
    expect(isValid).toBe(true);
  });

  it('returns false for null input', () => {
    const isValid = isAuthModule(null);
    expect(isValid).toBe(false);
  });

  it('returns false for undefined input', () => {
    const isValid = isAuthModule(undefined);
    expect(isValid).toBe(false);
  });

  it('returns false for non-object input (string)', () => {
    const isValid = isAuthModule('string');
    expect(isValid).toBe(false);
  });

  it('returns false for non-object input (number)', () => {
    const isValid = isAuthModule(42);
    expect(isValid).toBe(false);
  });

  it('returns false for non-object input (boolean)', () => {
    const isValid = isAuthModule(true);
    expect(isValid).toBe(false);
  });

  it('returns false when auth property is missing', () => {
    const isValid = isAuthModule({ other: 'data' });
    expect(isValid).toBe(false);
  });

  it('returns false when calConnectToken is null', () => {
    const isValid = isAuthModule({ auth: { calConnectToken: null } });
    expect(isValid).toBe(false);
  });

  it('returns false when calConnectToken is empty string', () => {
    const isValid = isAuthModule({ auth: { calConnectToken: '' } });
    expect(isValid).toBe(false);
  });

  it('returns false when calConnectToken is whitespace only', () => {
    const isValid = isAuthModule({ auth: { calConnectToken: '   ' } });
    expect(isValid).toBe(false);
  });

  it('returns false when auth is null', () => {
    const isValid = isAuthModule({ auth: null });
    expect(isValid).toBe(false);
  });
});

describe('authModuleOrUndefined', () => {
  it('returns the auth module when valid', () => {
    const validModule = { auth: { calConnectToken: 'tok-abc' } };
    const result = authModuleOrUndefined(validModule);
    expect(result).toBe(validModule);
  });

  it('returns undefined for null input', () => {
    const result = authModuleOrUndefined(null);
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty object', () => {
    const result = authModuleOrUndefined({});
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty calConnectToken', () => {
    const result = authModuleOrUndefined({ auth: { calConnectToken: '' } });
    expect(result).toBeUndefined();
  });

  it('returns undefined for number input', () => {
    const result = authModuleOrUndefined(123);
    expect(result).toBeUndefined();
  });

  it('returns undefined for string input', () => {
    const result = authModuleOrUndefined('string');
    expect(result).toBeUndefined();
  });
});

describe('isPending', () => {
  it('returns true for pending transaction without debCrdDate', () => {
    const pending = {
      merchantID: 'M001',
      merchantName: 'Shop',
      trnPurchaseDate: '2024-01-15',
      walletTranInd: 0,
      transactionsOrigin: 1,
      trnAmt: 100,
      tpaApprovalAmount: null,
      trnCurrencySymbol: 'ILS',
      trnTypeCode: 1,
      trnType: 'Regular',
      branchCodeDesc: '',
      transCardPresentInd: true,
      j5Indicator: '',
      numberOfPayments: 1,
      firstPaymentAmount: 100,
      transTypeCommentDetails: [],
    };
    const isPendingResult = isPending(pending as never);
    expect(isPendingResult).toBe(true);
  });

  it('returns false for completed transaction with debCrdDate', () => {
    const completed = {
      debCrdDate: '2024-02-01',
      merchantName: 'Shop',
      trnPurchaseDate: '2024-01-15',
      trnAmt: 100,
      trnCurrencySymbol: 'ILS',
      trnTypeCode: 1,
      trnType: 'Regular',
      branchCodeDesc: '',
      transCardPresentInd: true,
    };
    const isPendingResult = isPending(completed as never);
    expect(isPendingResult).toBe(false);
  });
});

describe('isCardTransactionDetails', () => {
  it('returns true when result property exists', () => {
    const details = {
      title: 'OK',
      statusCode: 1,
      statusDescription: 'Success',
      statusTitle: 'OK',
      result: { bankAccounts: [], blockedCardInd: false },
    };
    const isDetails = isCardTransactionDetails(details as never);
    expect(isDetails).toBe(true);
  });

  it('returns false for error status without result', () => {
    const errorStatus = { title: 'Error', statusCode: 0 };
    const isDetails = isCardTransactionDetails(errorStatus as never);
    expect(isDetails).toBe(false);
  });
});

describe('isCardPendingTransactionDetails', () => {
  it('returns true when result property exists', () => {
    const details = {
      title: 'OK',
      statusCode: 1,
      statusDescription: 'Success',
      statusTitle: 'OK',
      result: { cardsList: [] },
    };
    const isDetails = isCardPendingTransactionDetails(details as never);
    expect(isDetails).toBe(true);
  });

  it('returns false for error status without result', () => {
    const errorStatus = { title: 'Error', statusCode: 0 };
    const isDetails = isCardPendingTransactionDetails(errorStatus as never);
    expect(isDetails).toBe(false);
  });

  it('returns true even when result is empty object', () => {
    const withResult = { title: 'OK', statusCode: 1, result: {} };
    const isDetails = isCardPendingTransactionDetails(withResult as never);
    expect(isDetails).toBe(true);
  });
});
