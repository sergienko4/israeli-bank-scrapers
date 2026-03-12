/** Max ms to wait for a single $() call before treating it as not found. */
export const CANDIDATE_TIMEOUT_MS = 2000;

/** Minimum length of an ID-like selector value to classify as 'id' credential. */
export const MIN_ID_LENGTH = 4;

/** Maps various HTML field names (lowercased) to standard credential keys. */
export const CREDENTIAL_KEY_MAP: Record<string, string> = {
  password: 'password',
  sisma: 'password',
  tzpassword: 'password',
  usercode: 'username',
  username: 'username',
  usernum: 'username',
  uid: 'id',
  tzid: 'id',
  aidnum: 'num',
  num: 'num',
  account: 'num',
};
