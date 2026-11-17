/** Native fetch() timeout — bank APIs rarely take longer than this. */
export const NETWORK_FETCH_TIMEOUT_MS = 30_000;

/**
 * Fresh-connection retries after a connect timeout, on top of the first attempt.
 * A connect timeout never reached the server, so repeating it is side-effect free.
 * Bank edges that drop about half of new handshakes need several tries.
 */
export const NETWORK_CONNECT_RETRIES = 4;

/** Largest body a capped native transport buffers, in bytes (8 MiB). The base
 * uncapped transport keeps fetch's own streaming behavior. */
export const NETWORK_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
