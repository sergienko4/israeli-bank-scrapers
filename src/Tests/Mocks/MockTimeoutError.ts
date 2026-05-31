/** Mock TimeoutError for unit tests — must be distinct from Error for instanceof checks. */
export default class MockTimeoutError extends Error {}
