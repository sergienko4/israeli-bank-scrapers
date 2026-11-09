/**
 * The website's supported password challenge and completion outcomes.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  IAnswerCheck,
  IAnswerClassifier,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';

const METHOD = '/data/control_flow/0/methods/0';
const PENDING_PASSWORD: readonly IAnswerCheck[] = [
  { pointer: '/data/state', equals: 'pending' },
  { pointer: '/data/control_flow', items: 1 },
  { pointer: '/data/control_flow/0/type', equals: 'authentication' },
  { pointer: '/data/control_flow/0/methods', items: 1 },
  { pointer: `${METHOD}/type`, equals: 'password' },
];
const NOT_LOCKED: IAnswerCheck = { pointer: `${METHOD}/locked`, equals: false };
const NOT_EXPIRED: IAnswerCheck = { pointer: `${METHOD}/expired`, equals: false };

/**
 * Requires bounded text that is not whitespace-only.
 * @param pointer - Value in the opened answer.
 * @param maxChars - Longest accepted value.
 * @returns The complementary text checks.
 */
function nonblankChecks(pointer: string, maxChars: number): readonly IAnswerCheck[] {
  const text = { maxChars };
  const blank = { ...text, pattern: String.raw`^\s+$` };
  return [
    { pointer, text },
    { pointer, text: blank, negate: true },
  ];
}

const SESSION_CHECKS = [
  '/headers/?type=session_id/session_id',
  '/headers/?type=device_id/device_id',
].flatMap(pointer => nonblankChecks(pointer, 512));

const LEUMI_LOGIN_CLASSIFIER: IAnswerClassifier = {
  into: 'loginBranch',
  cases: [
    {
      name: 'password',
      when: [
        ...PENDING_PASSWORD,
        NOT_LOCKED,
        NOT_EXPIRED,
        ...SESSION_CHECKS,
        ...nonblankChecks('/data/challenge', 16384),
        ...nonblankChecks(`${METHOD}/assertion_id`, 2048),
      ],
      captures: {
        challenge: { pointer: '/data/challenge', maxChars: 16384 },
        pwdAssertionId: { pointer: `${METHOD}/assertion_id`, maxChars: 2048 },
      },
    },
    {
      name: 'locked',
      when: [...PENDING_PASSWORD, { pointer: `${METHOD}/locked`, equals: true }],
      fail: ScraperErrorTypes.AccountBlocked,
    },
    {
      name: 'expired',
      when: [...PENDING_PASSWORD, NOT_LOCKED, { pointer: `${METHOD}/expired`, equals: true }],
      fail: ScraperErrorTypes.ChangePassword,
    },
  ],
};

const COMPLETED: readonly IAnswerCheck[] = [
  { pointer: '/data/state', equals: 'completed' },
  { pointer: '/data/assertions_complete', equals: true },
  { pointer: '/data/token', text: { maxChars: 32768, pattern: String.raw`^[^\x00-\x20\x7f]+$` } },
];
const WEBSITE_STATUS = '/data/data/json_data/ts_status';
const LEUMI_PASSWORD_CLASSIFIER: IAnswerClassifier = {
  into: 'authBranch',
  cases: [
    { name: 'done', when: [...COMPLETED, { pointer: WEBSITE_STATUS, equals: 0 }] },
    {
      name: 'reminder',
      when: [...COMPLETED, { pointer: WEBSITE_STATUS, equals: 5 }],
      fail: ScraperErrorTypes.ChangePassword,
    },
  ],
};

export { LEUMI_LOGIN_CLASSIFIER, LEUMI_PASSWORD_CLASSIFIER };
