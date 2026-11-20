/**
 * Shared fakes for the PR review unit tests. These helpers only build local
 * Response objects; they never call the network.
 */

/**
 * Read a fetch input URL without the `[object Object]` default.
 * @param input - Fetch input.
 * @returns URL text.
 */
export function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/**
 * Build a JSON API response.
 * @param body - Response body.
 * @param status - HTTP status.
 * @returns Fake response.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Wrap one JSON body as a resolved fetch response.
 * @param body - Response body.
 * @param status - HTTP status.
 * @returns Resolved response.
 */
export function responseTo(body: unknown, status = 200): Promise<Response> {
  const response = jsonResponse(body, status);
  return Promise.resolve(response);
}

/**
 * Read the Accept header from fetch options.
 * @param init - Fetch options.
 * @returns Header value, or empty.
 */
export function acceptOf(init?: RequestInit): string {
  const headers = new Headers(init?.headers);
  return headers.get('Accept') ?? '';
}

/**
 * A pull request metadata response for one head SHA.
 * @param sha - Head SHA.
 * @returns Resolved response.
 */
export function metadataResponse(sha: string): Promise<Response> {
  return responseTo({
    state: 'open',
    base: { sha: 'base-sha' },
    head: { sha, ref: 'feature', repo: { full_name: 'sergienko4/repo' } },
  });
}
