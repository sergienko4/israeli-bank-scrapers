/**
 * WellKnown request-envelope origin for the BaNCS-core digital app
 * (Yahav). The message body carries a top-level `UIID`
 * (`{Ver:"UIIDomain_1.0.0", Id}`) that identifies the originating UI
 * screen. The bank's input validator rejects a data-bearing
 * transaction INQ whose origin (`UIID.Id`) is empty with
 * ServerStatusCd `88501` ("error from input validator",
 * `SubjctElmnt.Path:"origin"`) — but ONLY on windows that actually
 * contain rows; empty windows short-circuit with `Code:0` before the
 * origin is validated.
 *
 * <p>The dashboard-captured filtered template carries an EMPTY origin
 * (its default narrow window had no rows, so the UI never tripped the
 * validator), so replay must restore it. `HomePage` is the origin the
 * bank's own working inquiry used — run `29-06-2026_19271361`
 * login-POST/0020 sent `UIID.Id:"HomePage"` and returned `Code:0`
 * with the real transaction. The structural marker `UIIDomain` is
 * BaNCS-unique, so gating on it leaves every other bank's body
 * byte-identical.
 */
const PIPELINE_WELL_KNOWN_REQUEST_ORIGIN = {
  /** Top-level envelope key holding the origin object. */
  envelopeKey: 'UIID',
  /** Field inside the envelope holding the version marker string. */
  verField: 'Ver',
  /** Substring proving the envelope is a BaNCS UIIDomain origin. */
  verMarker: 'UIIDomain',
  /** Field inside the envelope that carries the origin screen id. */
  idField: 'Id',
  /** Origin value the bank's own working inquiry used. */
  value: 'HomePage',
} as const;

export default PIPELINE_WELL_KNOWN_REQUEST_ORIGIN;
