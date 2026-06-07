/**
 * Unit tests for OTP challenge nonce binding.
 */

import {
  assertOtpSubmission,
  createOtpChallengeState,
  DEFAULT_TEST_OTP_CODE,
  issueChallenge,
} from '../../../Integration/Mirror/MirrorOtpChallenge.js';

describe('issueChallenge', () => {
  it('mints a unique nonce per call and persists it in state', () => {
    const state = createOtpChallengeState();
    const a = issueChallenge(state);
    const b = issueChallenge(state);
    expect(a).toMatch(/^otp-[a-z0-9]{9}$/);
    expect(b).toMatch(/^otp-[a-z0-9]{9}$/);
    expect(a).not.toBe(b);
    expect(state.nonce).toBe(b);
  });
});

describe('assertOtpSubmission — accepted', () => {
  it('returns accepted when code AND nonce match', () => {
    const state = createOtpChallengeState();
    const nonce = issueChallenge(state);
    const result = assertOtpSubmission({
      state,
      submittedCode: DEFAULT_TEST_OTP_CODE,
      submittedNonce: nonce,
      expectedCode: DEFAULT_TEST_OTP_CODE,
    });
    expect(result).toBe('accepted');
  });
});

describe('assertOtpSubmission — wrongCode', () => {
  it('returns wrongCode when nonce matches but code differs', () => {
    const state = createOtpChallengeState();
    const nonce = issueChallenge(state);
    const result = assertOtpSubmission({
      state,
      submittedCode: '999999',
      submittedNonce: nonce,
      expectedCode: DEFAULT_TEST_OTP_CODE,
    });
    expect(result).toBe('wrongCode');
  });
});

describe('assertOtpSubmission — wrongNonce', () => {
  it('returns wrongNonce when state has no issued challenge', () => {
    const state = createOtpChallengeState();
    const result = assertOtpSubmission({
      state,
      submittedCode: DEFAULT_TEST_OTP_CODE,
      submittedNonce: 'otp-stale',
      expectedCode: DEFAULT_TEST_OTP_CODE,
    });
    expect(result).toBe('wrongNonce');
  });

  it('returns wrongNonce when submitted nonce differs from issued', () => {
    const state = createOtpChallengeState();
    issueChallenge(state);
    const result = assertOtpSubmission({
      state,
      submittedCode: DEFAULT_TEST_OTP_CODE,
      submittedNonce: 'otp-elsewhere',
      expectedCode: DEFAULT_TEST_OTP_CODE,
    });
    expect(result).toBe('wrongNonce');
  });
});
