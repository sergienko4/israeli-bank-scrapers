/**
 * Shared WK constants — used by PRE step of every phase.
 * CLOSE_POPUP clears overlays before discovery.
 */

/** Popup close candidates — used by every PRE step. */
const WK_CLOSE_POPUP = [
  { kind: 'textContent', value: 'סגור' },
  { kind: 'textContent', value: 'close' },
  { kind: 'textContent', value: 'ביטול' },
  { kind: 'textContent', value: '✕' },
  { kind: 'ariaLabel', value: 'סגור' },
  { kind: 'ariaLabel', value: 'close' },
] as const;

export default WK_CLOSE_POPUP;
export { WK_CLOSE_POPUP };
