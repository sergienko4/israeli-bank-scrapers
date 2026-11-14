/**
 * Every login step name the API-direct flow recognises.
 */

type StepName =
  | 'bind'
  | 'login'
  | 'assertPassword'
  | 'assertOtp'
  | 'getIdToken'
  | 'sessionToken'
  | 'prime'
  | 'validate'
  | 'deviceKey'
  | 'register'
  | 'resume'
  | 'bootstrap'
  | 'landing'
  | 'logon'
  | 'encryptionKey'
  | 'identify'
  | 'verify'
  | 'otpInit'
  | 'otpVerify'
  | 'step1'
  | 'arcotid'
  | 'stepupInit'
  | 'stepupVerify'
  | 'arcotidAfter';

export type { StepName };
