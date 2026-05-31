/**
 * Shared WK constants — used by PRE step of every phase.
 * CLOSE_POPUP clears overlays before discovery.
 */

/** Popup close candidates — used by every PRE step. */
const WK_CLOSE_POPUP = [
  { kind: 'exactText', value: 'סגור' },
  { kind: 'exactText', value: 'close' },
  { kind: 'exactText', value: 'ביטול' },
  { kind: 'exactText', value: '✕' },
  { kind: 'ariaLabel', value: 'סגור' },
  { kind: 'ariaLabel', value: 'close' },
] as const;

export default WK_CLOSE_POPUP;
export { WK_CLOSE_POPUP };
