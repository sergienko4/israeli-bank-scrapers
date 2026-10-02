/**
 * Oracle for the transport failure-text invariant: whatever a runtime, a
 * browser or a server says about a failed request, a secret carried in the
 * request's query never reaches the failure message.
 *
 * The echo shapes are the ones the runtimes really produce — the undici lines
 * were captured from Node 24's own `fetch`. Every transport test runs the same
 * table, so a new transport or a new echo shape is one row, not a new check.
 */

/** A device-bound id, as Pepper's auth calls carry it in the query. */
const ECHO_SECRET = 'SECRET-DEVICE-ID';

/** A signature whose wire form is percent-encoded — echoed decoded or not. */
const ECHO_SIGNATURE = 'sig+with/slash=';

/** The signature as it appears on the wire. */
const ECHO_SIGNATURE_WIRE = encodeURIComponent(ECHO_SIGNATURE);

/** Query every echo-test request carries: two secrets and a short flag. */
const ECHO_QUERY = `?did=${ECHO_SECRET}&sig=${ECHO_SIGNATURE_WIRE}&aid=app`;

/** Every form of a secret that must never surface. */
const ECHO_SECRET_FORMS: readonly string[] = [ECHO_SECRET, ECHO_SIGNATURE, ECHO_SIGNATURE_WIRE];

/** One way failure text can quote a request back. */
interface IUrlEcho {
  readonly label: string;
  readonly text: string;
}

/**
 * Runtime echoes: what a transport's own exception says about the request.
 * @param url - The secret-carrying request URL.
 * @returns Echo rows quoting the URL the way runtimes do.
 */
function runtimeEchoesOf(url: string): readonly IUrlEcho[] {
  const afterScheme = url.slice(url.indexOf('//') + 2);
  const credentialLine = `includes credentials: ******${afterScheme}`;
  return [
    {
      label: 'undici credential mask',
      text: `Request cannot be constructed from a URL that ${credentialLine}`,
    },
    { label: 'undici unparseable URL', text: `Failed to parse URL from ${url}` },
    { label: 'quoted absolute URL', text: `request to ${url} failed, reason: ECONNREFUSED` },
    {
      label: 'playwright call log',
      text: `page.goto: NS_ERROR_UNKNOWN_HOST\n  - navigating to "${url}"`,
    },
  ];
}

/**
 * Server echoes: what an error body says about the request.
 * @param url - The secret-carrying request URL.
 * @returns Echo rows quoting the path, query or one value.
 */
function serverEchoesOf(url: string): readonly IUrlEcho[] {
  const pathAndQuery = `${new URL(url).pathname}${ECHO_QUERY}`;
  return [
    { label: 'server path echo', text: `Bad request for ${pathAndQuery}` },
    { label: 'server value echo', text: `unknown device ${ECHO_SECRET}, sig ${ECHO_SIGNATURE}` },
  ];
}

/**
 * Every echo shape for a request to `base` carrying {@link ECHO_QUERY}.
 * @param base - Origin + path of the request.
 * @returns The request URL and its echo rows.
 */
function urlEchoesOf(base: string): readonly IUrlEcho[] {
  const url = `${base}${ECHO_QUERY}`;
  return [...runtimeEchoesOf(url), ...serverEchoesOf(url)];
}

/**
 * Secrets of {@link ECHO_QUERY} that a failure text still carries.
 * @param text - Failure text under test.
 * @returns The leaked forms; empty when the text is clean.
 */
function leakedSecretsIn(text: string): readonly string[] {
  return ECHO_SECRET_FORMS.filter((form): boolean => text.includes(form));
}

export type { IUrlEcho };
export { ECHO_QUERY, ECHO_SECRET, leakedSecretsIn, urlEchoesOf };
