/**
 * VisaCal type guard branch-coverage tests.
 * Covers additional branches: isAuthModule (object with auth but no calConnectToken),
 * authModuleOrUndefined (various falsy paths), isPending (edge cases),
 * isCardTransactionDetails/isCardPendingTransactionDetails (boundary values).
 */
import {
  authModuleOrUndefined,
  isAuthModule,
  isCardPendingTransactionDetails,
  isCardTransactionDetails,
  isPending,
} from '../../Scrapers/VisaCal/VisaCalTypes.js';

describe('isAuthModule — additional branch coverage', () => {
  it('returns false for empty object', () => {
    const isAuth = isAuthModule({});
    expect(isAuth).toBe(false);
  });

  it('returns false for array input', () => {
    const isAuth = isAuthModule([]);
    expect(isAuth).toBe(false);
  });

  it('returns false when auth is undefined', () => {
    const isAuth = isAuthModule({ auth: undefined });
    expect(isAuth).toBe(false);
  });

  it('returns false when calConnectToken is missing entirely', () => {
    const isAuth = isAuthModule({ auth: {} });
    expect(isAuth).toBe(false);
  });

  it('returns true for token with leading/trailing spaces and content', () => {
    const isAuth = isAuthModule({ auth: { calConnectToken: '  token  ' } });
    expect(isAuth).toBe(true);
  });

  it('returns false for zero number input', () => {
    const isAuth = isAuthModule(0);
    expect(isAuth).toBe(false);
  });

  it('returns false for false boolean', () => {
    const isAuth = isAuthModule(false);
    expect(isAuth).toBe(false);
  });
});

describe('authModuleOrUndefined — additional branches', () => {
  it('returns undefined for boolean false', () => {
    const authMod = authModuleOrUndefined(false);
    expect(authMod).toBeUndefined();
  });

  it('returns undefined for zero', () => {
    const authMod = authModuleOrUndefined(0);
    expect(authMod).toBeUndefined();
  });

  it('returns module for valid token with spaces', () => {
    const mod = { auth: { calConnectToken: ' valid ' } };
    const authMod = authModuleOrUndefined(mod);
    expect(authMod).toBe(mod);
  });

  it('returns undefined for object with null auth', () => {
    const authMod = authModuleOrUndefined({ auth: null });
    expect(authMod).toBeUndefined();
  });

  it('returns undefined for array', () => {
    const authMod = authModuleOrUndefined([1, 2, 3]);
    expect(authMod).toBeUndefined();
  });
});

describe('isPending — edge case branches', () => {
  it('returns true when debCrdDate key is absent', () => {
    const pending = { merchantName: 'Test', trnAmt: 50 };
    const isPend = isPending(pending as never);
    expect(isPend).toBe(true);
  });

  it('returns false when debCrdDate key exists with empty string', () => {
    const completed = { debCrdDate: '', merchantName: 'Test', trnAmt: 50 };
    const isPend = isPending(completed as never);
    expect(isPend).toBe(false);
  });

  it('returns false when debCrdDate key exists with null value', () => {
    const completed = { debCrdDate: null, merchantName: 'Test', trnAmt: 50 };
    const isPend = isPending(completed as never);
    expect(isPend).toBe(false);
  });
});

describe('isCardTransactionDetails — additional branches', () => {
  it('returns true when result property is null', () => {
    const details = { title: 'OK', statusCode: 1, result: null };
    const isDetails = isCardTransactionDetails(details as never);
    expect(isDetails).toBe(true);
  });

  it('returns true when result property is empty array', () => {
    const details = { title: 'OK', statusCode: 1, result: [] };
    const isDetails = isCardTransactionDetails(details as never);
    expect(isDetails).toBe(true);
  });

  it('returns false when only title and statusCode', () => {
    const status = { title: 'Fail', statusCode: -1 };
    const isDetails = isCardTransactionDetails(status as never);
    expect(isDetails).toBe(false);
  });
});

describe('isCardPendingTransactionDetails — additional branches', () => {
  it('returns true when result is null', () => {
    const details = { title: 'OK', statusCode: 1, result: null };
    const isDetails = isCardPendingTransactionDetails(details as never);
    expect(isDetails).toBe(true);
  });

  it('returns false when result absent but other props exist', () => {
    const status = { title: 'Error', statusCode: 0, statusDescription: 'Failed' };
    const isDetails = isCardPendingTransactionDetails(status as never);
    expect(isDetails).toBe(false);
  });

  it('returns true when result has nested empty data', () => {
    const details = { title: 'OK', statusCode: 1, result: { cardsList: [] } };
    const isDetails = isCardPendingTransactionDetails(details as never);
    expect(isDetails).toBe(true);
  });
});
