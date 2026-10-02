/**
 * Oracle for the transport failure-text invariant: whatever a runtime, a
 * browser or a server says about a failed request, a secret carried in the
 * request's query never reaches the failure message — whole, re-encoded or as
 * a fragment.
 *
 * The echo shapes are the ones the runtimes really produce — the undici lines
 * were captured from Node 24's own `fetch`, the parse rows follow V8's own
 * `JSON.parse` excerpt. Every transport test runs the same table, so a new
 * transport or a new echo shape is one row, not a new check.
 */

import { ERROR_BODY_SNIPPET_LEN } from '../../Scrapers/Pipeline/Strategy/Fetch/SafeUrlForLog.js';

/** A device-bound id, as Pepper's auth calls carry it in the query. */
const ECHO_SECRET = 'SECRET-DEVICE-ID';

/** A signature whose wire form is percent-encoded — echoed decoded or not. */
const ECHO_SIGNATURE = 'sig+with/slash=';

/** The signature as it appears on the wire. */
const ECHO_SIGNATURE_WIRE = encodeURIComponent(ECHO_SIGNATURE);

/** A name: secret-sized on the wire, only seven characters once decoded. */
const ECHO_NAME = 'שרה כהן';

/** The name as it appears on the wire — `%20` for the space. */
const ECHO_NAME_WIRE = encodeURIComponent(ECHO_NAME);

/** The name as an HTML form encodes it — `+` for the space. */
const ECHO_NAME_FORM = ECHO_NAME_WIRE.replaceAll('%20', '+');

/** Query every echo-test request carries: three secrets and a short flag. */
const ECHO_QUERY = `?did=${ECHO_SECRET}&sig=${ECHO_SIGNATURE_WIRE}&name=${ECHO_NAME_WIRE}&aid=app`;

/** Canary user name for a request URL that carries credentials. */
const ECHO_USER = 'ECHO-USER-NAME';

/** Canary password for a request URL that carries credentials. */
const ECHO_PASS = 'ECHO-PASS-WORD';

/** Every form of a secret that must never surface. */
const ECHO_SECRET_FORMS: readonly string[] = [
  ECHO_SECRET,
  ECHO_SIGNATURE,
  ECHO_SIGNATURE_WIRE,
  ECHO_NAME,
  ECHO_NAME_WIRE,
  ECHO_NAME_FORM,
  ECHO_USER,
  ECHO_PASS,
];

/** Shortest run of a secret that counts as a leak — a cut value still leaks. */
const MIN_LEAK_FRAGMENT_LEN = 6;

/** One way failure text can quote a request back. */
interface IUrlEcho {
  readonly label: string;
  readonly text: string;
}

/**
 * The request URL with the canary credentials added.
 * @param url - The secret-carrying request URL.
 * @returns The same URL carrying a user name and password.
 */
function withEchoCredentials(url: string): string {
  const parsed = new URL(url);
  parsed.username = ECHO_USER;
  parsed.password = ECHO_PASS;
  return parsed.href;
}

/**
 * Runtime echoes: what a transport's own exception says about the request.
 * Node 24's `fetch` quotes a credential-bearing URL in full — credentials,
 * query and all — so nothing in the runtime masks it.
 * @param url - The secret-carrying request URL.
 * @returns Echo rows quoting the URL the way runtimes do.
 */
function runtimeEchoesOf(url: string): readonly IUrlEcho[] {
  const credentialUrl = withEchoCredentials(url);
  return [
    {
      label: 'undici credential URL',
      text: `Request cannot be constructed from a URL that includes credentials: ${credentialUrl}`,
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
 * @returns Echo rows quoting the path, query or one value in any encoding.
 */
function serverEchoesOf(url: string): readonly IUrlEcho[] {
  const pathAndQuery = `${new URL(url).pathname}${ECHO_QUERY}`;
  const values = `${ECHO_SECRET}, sig ${ECHO_SIGNATURE}, name ${ECHO_NAME}`;
  return [
    { label: 'server path echo', text: `Bad request for ${pathAndQuery}` },
    { label: 'server value echo', text: `unknown device ${values}` },
    { label: 'server form-encoded echo', text: `no customer named ${ECHO_NAME_FORM}` },
  ];
}

/**
 * Body echoes that only a cut reveals: V8's `JSON.parse` quotes up to ten
 * characters either side of the error, and a body snippet stops at a fixed
 * length — both can end mid-secret.
 * @returns Echo rows whose secret is cut by a parser excerpt or a snippet.
 */
function cutEchoes(): readonly IUrlEcho[] {
  const padding = 'x'.repeat(ERROR_BODY_SNIPPET_LEN - 9);
  return [
    { label: 'body opening with a secret', text: `${ECHO_SECRET} is not a known device` },
    { label: 'body breaking on a secret', text: `{"device": ${ECHO_SECRET}}` },
    { label: 'body opening with a wire-form secret', text: `${ECHO_NAME_WIRE} not found` },
    { label: 'secret across the snippet cut', text: `${padding}${ECHO_SECRET} trailing` },
  ];
}

/**
 * Every echo shape for a request to `base` carrying {@link ECHO_QUERY}.
 * @param base - Origin + path of the request.
 * @returns The request URL and its echo rows.
 */
function urlEchoesOf(base: string): readonly IUrlEcho[] {
  const url = `${base}${ECHO_QUERY}`;
  return [...runtimeEchoesOf(url), ...serverEchoesOf(url), ...cutEchoes()];
}

/**
 * Every {@link MIN_LEAK_FRAGMENT_LEN}-long run of a secret form.
 * @param form - One secret form.
 * @returns Its fragments, or the form itself when it is shorter.
 */
function fragmentsOf(form: string): readonly string[] {
  const count = Math.max(form.length - MIN_LEAK_FRAGMENT_LEN + 1, 1);
  const starts = Array.from({ length: count }, (_, start): number => start);
  return starts.map((start): string => form.slice(start, start + MIN_LEAK_FRAGMENT_LEN));
}

/**
 * Secrets of {@link ECHO_QUERY} (and the canary credentials) that a failure
 * text still carries, whole or as a fragment.
 * @param text - Failure text under test.
 * @returns The leaked forms; empty when the text is clean.
 */
function leakedSecretsIn(text: string): readonly string[] {
  return ECHO_SECRET_FORMS.filter((form): boolean =>
    fragmentsOf(form).some((fragment): boolean => text.includes(fragment)),
  );
}

export type { IUrlEcho };
export { ECHO_QUERY, ECHO_SECRET, leakedSecretsIn, urlEchoesOf, withEchoCredentials };
