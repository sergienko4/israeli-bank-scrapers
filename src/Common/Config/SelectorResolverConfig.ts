/** Max ms to wait for a single $() call before treating it as not found. */
export const CANDIDATE_TIMEOUT_MS = 2000;

/** Minimum length of an ID-like selector value to classify as 'id' credential. */
export const MIN_ID_LENGTH = 4;

/** Standard credential key names — maps HTML field labels to scraper credential keys. */
enum CredentialKey {
  Password = 'password',
  Username = 'username',
  Id = 'id',
  Num = 'num',
}

/** Maps various HTML field names (lowercased) to standard credential keys. */
export const CREDENTIAL_KEY_MAP: Record<string, string> = {
  [CredentialKey.Password]: CredentialKey.Password,
  sisma: CredentialKey.Password,
  tzpassword: CredentialKey.Password,
  usercode: CredentialKey.Username,
  [CredentialKey.Username]: CredentialKey.Username,
  usernum: CredentialKey.Username,
  uid: CredentialKey.Id,
  tzid: CredentialKey.Id,
  aidnum: CredentialKey.Num,
  [CredentialKey.Num]: CredentialKey.Num,
  account: CredentialKey.Num,
};
