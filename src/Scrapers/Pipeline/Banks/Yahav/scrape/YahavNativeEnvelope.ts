/**
 * Yahav native BaNCS envelope builder (spec §10.2). Wraps a payload in the
 * envelope the app sends: the fixed blocks in their wire order, a `MsgId` and
 * `TimeStamp` from one instant, and the security token. A login sends an empty
 * token and no `csrfTkn`; a read replays the session's last token in place and
 * appends its `csrfTkn` before the payload.
 *
 * The timestamp carries the instant's UTC calendar and clock, under the offset
 * Asia/Jerusalem has at that instant (whatever the host zone), in
 * `Date#getTimezoneOffset` form: −180 in summer, −120 in winter.
 */

import type moment from 'moment';

import { bankMomentOfInstant } from '../../../Mediator/Scrape/BankCalendar.js';
import type { VarsMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import {
  YAHAV_BANCS_PATHS,
  YAHAV_ENVELOPE_VER,
  YAHAV_NATIVE_ORIGIN,
} from '../../../Registry/Config/PipelineBankConfigYahavConstants.js';
import {
  NATIVE_CHANNEL,
  NATIVE_EMPTY_SECTOKEN,
  NATIVE_LOGIN_PAYLOAD,
  NATIVE_VERSIONS,
} from './YahavNativeEnvelopeStatic.js';

/** Minutes in an hour, for splitting the zone offset. */
const MINUTES_PER_HOUR = 60;

/** BaNCS session state a read call replays. */
interface IYahavReadState {
  /** The last `SecToken` the bank issued. */
  readonly security: Readonly<Record<string, unknown>>;
  /** The last `csrfTkn` the bank issued. */
  readonly csrf: string;
}

/** What a read body is built from. */
interface IYahavReadBodyArgs {
  /** BaNCS path of the call. */
  readonly path: string;
  /** The one instant behind `MsgId` and `TimeStamp`. */
  readonly now: Date;
  readonly state: IYahavReadState;
  readonly payload: VarsMap;
}

/**
 * The same number with a positive zero, so `-0` never reaches the wire.
 * @param value - A number.
 * @returns The number, or `0` for either zero.
 */
function positiveZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * The `Timezone` block: the bank zone's offset as `Date#getTimezoneOffset`
 * reports it (negative east of UTC), split into whole hours and minutes.
 * @param inZone - The instant in the bank zone.
 * @returns Time-zone block.
 */
function timeZoneBlock(inZone: moment.Moment): VarsMap {
  const westMinutes = -inZone.utcOffset();
  const wholeHours = Math.trunc(westMinutes / MINUTES_PER_HOUR);
  const hours = positiveZero(wholeHours);
  const minutes = positiveZero(westMinutes % MINUTES_PER_HOUR);
  return { Ver: 'TimeZone_1.0.0', UTCOffsetHour: hours, UTCOffsetMinute: minutes, Abbr: 'UTC' };
}

/**
 * The calendar day on the UTC clock.
 * @param utcClock - The instant on the UTC clock.
 * @returns Day, month and year.
 */
function calendarParts(utcClock: moment.Moment): VarsMap {
  return { Day: utcClock.date(), Month: utcClock.month() + 1, Year: utcClock.year() };
}

/**
 * The time of day on the UTC clock.
 * @param utcClock - The instant on the UTC clock.
 * @returns Hour, minute, second and milliseconds.
 */
function clockParts(utcClock: moment.Moment): VarsMap {
  const time = { Hour: utcClock.hour(), Minute: utcClock.minute(), Second: utcClock.second() };
  return { ...time, Fraction: utcClock.millisecond() };
}

/**
 * The `TimeStamp` block.
 * @param now - The instant.
 * @returns Timestamp block.
 */
function timeStampBlock(now: Date): VarsMap {
  const inZone = bankMomentOfInstant(now);
  const utcClock = inZone.clone().utc();
  const zone = { Ver: 'DateTime_1.0.0', Timezone: timeZoneBlock(inZone) };
  const dateTime = { ...zone, ...calendarParts(utcClock), ...clockParts(utcClock) };
  return { Ver: 'Timestamp_1.0.0', Dttime: dateTime };
}

/**
 * The envelope for a path at an instant, with the empty security token.
 * @param path - BaNCS path of the call.
 * @param now - The instant.
 * @returns Envelope without a payload.
 */
function yahavEnvelope(path: string, now: Date): VarsMap {
  const head = { Ver: YAHAV_ENVELOPE_VER, Resource: `${YAHAV_NATIVE_ORIGIN}${path}` };
  const ms = now.getTime();
  const stamp = timeStampBlock(now);
  const tail = { MsgId: String(ms), TimeStamp: stamp, SecToken: NATIVE_EMPTY_SECTOKEN };
  return { ...head, ...NATIVE_VERSIONS, ...NATIVE_CHANNEL, ...tail };
}

/**
 * The login body: the envelope and the credential payload, no `csrfTkn`.
 * @param now - The instant.
 * @returns Login body.
 */
function yahavLoginBody(now: Date): VarsMap {
  const envelope = yahavEnvelope(YAHAV_BANCS_PATHS.login, now);
  return { ...envelope, Payload: NATIVE_LOGIN_PAYLOAD };
}

/**
 * A read body: the session's token in place of the empty one, then its
 * `csrfTkn`, then the payload.
 * @param args - Path, instant, session state and payload.
 * @returns Read body.
 */
function yahavReadBody(args: IYahavReadBodyArgs): VarsMap {
  const envelope = yahavEnvelope(args.path, args.now);
  const session = { SecToken: args.state.security, csrfTkn: args.state.csrf };
  return { ...envelope, ...session, Payload: args.payload };
}

export type { IYahavReadBodyArgs, IYahavReadState };
export { yahavLoginBody, yahavReadBody };
