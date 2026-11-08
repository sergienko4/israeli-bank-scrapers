/**
 * Fail every successful HTTP status except the bank's expected 200.
 */

import type { StatusAction, StatusPolicy } from '../../Types/Domain/FetchPolicy.js';

const NON_200_SUCCESS = Array.from({ length: 99 }, (_unused, index) => 201 + index);
const REFUSED: readonly (readonly [number, StatusAction])[] = NON_200_SUCCESS.map(code => [
  code,
  'fail',
]);
const ONLY_200_STATUS_POLICY: StatusPolicy = Object.fromEntries(REFUSED);

export default ONLY_200_STATUS_POLICY;
