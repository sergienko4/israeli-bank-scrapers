/** Max ms to wait for a single $() call before treating it as not found. */
export const CANDIDATE_TIMEOUT_MS = 2000;

/** Minimum length of an ID-like selector value to classify as 'id' credential. */
export const MIN_ID_LENGTH = 4;

/** Standard credential key names used as map values — NOT actual secrets. */
const CREDENTIAL_KEY_PASSWORD = 'password';
const CREDENTIAL_KEY_USERNAME = 'username';
const CREDENTIAL_KEY_ID = 'id';
const CREDENTIAL_KEY_NUM = 'num';

/** Maps various HTML field names (lowercased) to standard credential keys. */
export const CREDENTIAL_KEY_MAP: Record<string, string> = {
  password: CREDENTIAL_KEY_PASSWORD,
  sisma: CREDENTIAL_KEY_PASSWORD,
  tzpassword: CREDENTIAL_KEY_PASSWORD,
  usercode: CREDENTIAL_KEY_USERNAME,
  username: CREDENTIAL_KEY_USERNAME,
  usernum: CREDENTIAL_KEY_USERNAME,
  uid: CREDENTIAL_KEY_ID,
  tzid: CREDENTIAL_KEY_ID,
  aidnum: CREDENTIAL_KEY_NUM,
  num: CREDENTIAL_KEY_NUM,
  account: CREDENTIAL_KEY_NUM,
};
