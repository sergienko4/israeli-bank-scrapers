/**
 * Toggle the Camoufox mock between real-Firefox-launch (default) and
 * fake-page-eval mode used by E2eMocked tests that mock globalThis.fetch.
 * @param enabled - True to enable fake mode; false to restore default.
 * @returns The new mode (true if enabled, false otherwise).
 */
declare function setFakePageEvalMode(enabled: boolean): boolean;

/**
 * How many browser launches were requested since the mock loaded.
 * @returns Launch requests so far.
 */
declare function getLaunchCount(): number;

export { getLaunchCount, setFakePageEvalMode };
export default setFakePageEvalMode;
