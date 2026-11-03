/**
 * Fixed reasons a fetch strategy gives when it fails before any request has
 * left the process. Such a message holds no bank reply, so the login-step
 * sanitiser passes it on unchanged, and the consumer-install gate asserts on
 * it to prove a hermetic run.
 */

/** Camoufox did not start, so nothing was sent. */
const CAMOUFOX_LAUNCH_FAILED = 'camoufox launch failed';

/** Every local reason, matched at the start of a failure message. */
const LOCAL_FAILURE_REASONS: readonly string[] = [CAMOUFOX_LAUNCH_FAILED];

/**
 * Whether a failure message opens with a local, pre-request reason. Only the
 * opening counts: a transport message opens with its verb and URL, so a reply
 * that quotes one of these reasons is never taken for it.
 * @param message - Failure message.
 * @returns True when the failure happened before any request was sent.
 */
function isLocalFailureMessage(message: string): boolean {
  return LOCAL_FAILURE_REASONS.some((reason): boolean => message.startsWith(reason));
}

export { CAMOUFOX_LAUNCH_FAILED, isLocalFailureMessage };
