/**
 * SelectorLabelStrategies — barrel re-exporting the split sibling modules:
 * element classifiers, for-attribute resolver, xpath label strategies, and
 * textContent walk-up strategies. Public surface preserved.
 */

export {
  CLICKABLE_INPUT_TYPES,
  CLICKABLE_ROLES,
  CLICKABLE_TAGS,
  FILLABLE_INPUT_TYPES,
  isClickableElement,
  isFillableInput,
} from './SelectorLabelStrategies.elements.js';
export { findInputByForAttr } from './SelectorLabelStrategies.forAttr.js';
export type { ILabelStrategyOpts, QueryFn } from './SelectorLabelStrategies.types.js';
export {
  resolveByAncestorWalkUp,
  resolveByContainerInput,
  resolveTextContent,
} from './SelectorLabelStrategies.walkUp.js';
export {
  divSpanStrictXpath,
  resolveByAriaRef,
  resolveByNestedInput,
  resolveByProximity,
  resolveBySibling,
  resolveLabelStrategies,
  resolveLabelText,
} from './SelectorLabelStrategies.xpath.js';
