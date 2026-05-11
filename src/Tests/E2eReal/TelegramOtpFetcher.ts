/**
 * Telegram-side OTP delivery for CI E2E Real jobs.
 *
 * <p>The fetcher polls the Telegram Bot API's `getUpdates` endpoint
 * with `offset=-100` (read-only window of the last 100 updates),
 * filters by per-bank regex + chat id + message date, and resolves
 * with the captured digits. **It never advances the bot's confirmed
 * offset.** This is critical for the parallel-banks scenario: when
 * Hapoalim, Beinleumi, and OneZero all request OTPs in the same
 * matrix run, each fetcher reads the same shared queue and picks
 * out only its own bank's message via the regex. If any fetcher
 * called `getUpdates?offset=N` with a positive N, Telegram would
 * confirm-and-drop every update with id < N — purging another
 * bank's pending OTP. Read-only mode prevents that.
 *
 * <p>The trade-off is that the chat accumulates messages until
 * Telegram's 24-hour retention reaps them. For OTP volumes (a few
 * messages per hour at most) the 100-update window is more than
 * sufficient.
 *
 * <p>Live only inside `src/Tests/E2eReal/` — never imported from
 * `src/Scrapers/**`. The npm package's `files: ['lib/**']` field
 * excludes the entire `src/Tests/` tree from the published tarball,
 * so npm consumers see no surface change. Verified via
 * `npm pack --dry-run`.
 *
 * <p>Backward-compat: when `botToken` or `chatId` is empty, the
 * fetcher returns `false` synchronously — never makes a network
 * call. Callers in `OtpPoller` short-circuit on this result and
 * fall through to the existing env-var / poll-file / readline
 * tiers.
 */

import type { ScraperLogger } from '../../Scrapers/Pipeline/Types/Debug.js';

/** Bundled args — preserves the project's 3-param ceiling. */
interface ITelegramFetchArgs {
  /** Bot token from BotFather; empty disables the tier. */
  readonly botToken: string;
  /** Chat id (numeric or `@channel`); empty disables the tier. */
  readonly chatId: string;
  /**
   * Display name surfaced to the user in the prompt
   * (e.g. "Hapoalim", "Beinleumi"). Cannot be empty.
   */
  readonly bankName: string;
  /**
   * Digits-extraction regex used against the user's reply text.
   * MUST contain exactly one capture group. Default in callers is
   * `/(\d{4,8})/` — any 4-8 digit run. Per-bank attribution is
   * handled by `reply_to_message_id` (Telegram Reply feature),
   * not by the regex.
   */
  readonly bankRegex: RegExp;
  /** Hard deadline for the resolve loop (ms). */
  readonly timeoutMs: number;
  /** Pino logger (project-standard). */
  readonly log: ScraperLogger;
}

/** Telegram update — the subset we read. */
interface ITelegramUpdate {
  readonly update_id: number;
  readonly message?: {
    readonly chat: { readonly id: number };
    readonly text?: string;
    /** Message epoch (seconds) — present on text messages. */
    readonly date: number;
    /**
     * Set when the user used Telegram's Reply feature on a
     * specific message. Carries the message_id of the bot's
     * prompt that the user is replying to.
     */
    readonly reply_to_message?: { readonly message_id: number };
  };
}

/** Telegram sendMessage response envelope. */
interface ITelegramSendMessageResponse {
  readonly ok: boolean;
  readonly result?: { readonly message_id: number };
}

/** Telegram getUpdates response envelope. */
interface ITelegramGetUpdatesResponse {
  readonly ok: boolean;
  readonly result: readonly ITelegramUpdate[];
}

/** Skip-reason enum — closed list. */
type TelegramSkipReason =
  | 'missing-token'
  | 'missing-chat'
  | 'missing-bank-name'
  | 'invalid-timeout'
  | 'invalid-regex';

/**
 * Per-cycle long-poll budget (seconds). Capped well below Telegram's
 * 50 s ceiling.
 *
 * The natural choice would be 10 s, but live measurement on PR #215
 * (run 08-05-2026 23:54:11 → match at 23:56:13) showed the fetcher
 * sees the user's reply ~52 s AFTER it landed in Telegram's queue —
 * five 10-second cycles in which the reply was visible but the cycle
 * had not yet returned. With a `offset=-N` (read-only) request,
 * Telegram does NOT guarantee an early return on new data the way it
 * does for positive-offset polling, so the per-cycle wait is the
 * dominant component of detection latency.
 *
 * 1 s gives the user a sub-second ack experience (worst case ~1 s
 * after their reply lands in the queue) and stays at ~1 req/s over
 * the 180 s budget — well below Telegram's per-bot rate ceiling.
 * Going below 1 s would require explicit short-polling + a sleep
 * loop, which adds code complexity for a small UX gain. Positive-
 * offset polling would be even more responsive but breaks parallel-
 * fetcher safety in the matrix scenario (Hapoalim/Beinleumi/OneZero
 * in one Group A run).
 */
const TELEGRAM_LONG_POLL_S = 1;
/** HTTP client timeout — Telegram's long-poll + 5 s headroom. */
const HTTP_TIMEOUT_MS = 15_000;

/**
 * Last 4 chars of an arbitrary id, suitable for non-PII logging.
 * @param value - Source string.
 * @returns Last 4 characters or `***`.
 */
function tailMask(value: string): string {
  if (value.length <= 4) return '***';
  return `***${value.slice(-4)}`;
}

/**
 * Validate args before any HTTP call. Returns the skip reason
 * when validation fails, or `false` when args are sound.
 *
 * @param args - Fetcher input.
 * @returns Skip reason or `false`.
 */
function detectSkipReason(args: ITelegramFetchArgs): TelegramSkipReason | false {
  if (args.botToken.length === 0) return 'missing-token';
  if (args.chatId.length === 0) return 'missing-chat';
  if (args.bankName.length === 0) return 'missing-bank-name';
  if (args.timeoutMs <= 0) return 'invalid-timeout';
  if (!args.bankRegex.source.includes('(')) return 'invalid-regex';
  return false;
}

/**
 * Send the proactive prompt that tells the user "[bank] is waiting
 * for OTP — reply to THIS message with the code". The returned
 * message_id is what the fetcher matches against on every
 * subsequent reply (`reply_to_message.message_id`), so each
 * parallel fetcher's prompts and replies stay isolated.
 *
 * @param args - Fetcher input bundle.
 * @returns Bot's sent message_id, or `false` on transport failure.
 */
async function sendPromptMessage(args: ITelegramFetchArgs): Promise<number | false> {
  const url = `https://api.telegram.org/bot${args.botToken}/sendMessage`;
  const promptHeader = `🔔 *${args.bankName}* CI run is waiting for an OTP code.\n\n`;
  const promptBody =
    'Please *reply to this message* with the code from the SMS ' +
    "(e.g. '123456'). The reply MUST use Telegram's Reply feature " +
    'so the right CI job picks it up.';
  const text = `${promptHeader}${promptBody}`;
  const body = JSON.stringify({
    chat_id: args.chatId,
    text,
    parse_mode: 'Markdown',
    reply_markup: { force_reply: true, selective: true },
  });
  const signal = AbortSignal.timeout(HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal,
    });
    if (!res.ok) return false;
    const parsed = (await res.json()) as ITelegramSendMessageResponse;
    if (!parsed.ok || !parsed.result) return false;
    return parsed.result.message_id;
  } catch {
    return false;
  }
}

/** Bundled ack args — preserves the project's 3-param ceiling. */
interface ISendAckArgs {
  readonly botToken: string;
  readonly chatId: string;
  readonly text: string;
  readonly replyToMessageId: number;
}

/**
 * Post a follow-up acknowledgement message scoped to the original
 * prompt via `reply_to_message_id`. Best-effort: failures resolve
 * quietly so the OTP flow is never blocked by a chat-side error.
 *
 * @param args - Acknowledgement bundle.
 * @returns True once the call settled (resolved or swallowed).
 */
async function sendAckMessage(args: ISendAckArgs): Promise<true> {
  const url = `https://api.telegram.org/bot${args.botToken}/sendMessage`;
  const body = JSON.stringify({
    chat_id: args.chatId,
    text: args.text,
    parse_mode: 'Markdown',
    reply_to_message_id: args.replyToMessageId,
    allow_sending_without_reply: true,
  });
  const signal = AbortSignal.timeout(HTTP_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal,
    });
  } catch {
    // Best-effort UX message — never block the OTP flow on a chat error.
  }
  return true;
}

/**
 * Fetch a JSON response from Telegram with an explicit per-call
 * timeout. Network/parse errors resolve as `false` so the caller
 * can keep polling without crashing.
 *
 * @param url - Fully-qualified Telegram API URL.
 * @returns Parsed response or `false`.
 */
async function safeFetchUpdates(url: string): Promise<ITelegramGetUpdatesResponse | false> {
  // `AbortSignal.timeout` (Node 18+) replaces the manual setTimeout
  // pattern that the project's `no-restricted-syntax` rule forbids.
  const signal = AbortSignal.timeout(HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return false;
    const body = (await res.json()) as ITelegramGetUpdatesResponse;
    if (!body.ok) return false;
    return body;
  } catch {
    return false;
  }
}

/**
 * Telegram bot URL builder — keeps the token off any log surface.
 * @param token - Bot token.
 * @param query - Querystring portion (already URL-encoded).
 * @returns Fully-qualified Telegram API URL.
 */
function buildUpdatesUrl(token: string, query: string): string {
  return `https://api.telegram.org/bot${token}/getUpdates?${query}`;
}

/**
 * Find the first update whose message matches `bankRegex` in the
 * configured chat. Returns the captured digits or `false` when
 * no match in the batch.
 *
 * @param updates - Updates returned by Telegram.
 * @param chatId - Numeric chat id we filter on.
 * @param bankRegex - Per-bank regex with one capture group.
 * @returns Match payload or `false`.
 */
/** Result of one update inspection. */
type MatchResult = { readonly code: string; readonly updateId: number } | false;

/** Bundled inspection args — preserves the project's 3-param ceiling. */
interface IInspectArgs {
  readonly upd: ITelegramUpdate;
  readonly targetChat: number;
  readonly bankRegex: RegExp;
  /** Update_id floor — only updates with `update_id > this` qualify. */
  readonly minUpdateId: number;
  /**
   * The bot's prompt `message_id`. Only updates whose
   * `reply_to_message.message_id` matches this value are accepted.
   * This is the parallel-safety mechanism: each fetcher's prompt
   * has a unique `message_id`, so concurrent fetchers' replies
   * stay isolated even on a shared chat.
   */
  readonly promptMessageId: number;
}

/**
 * Inspect a single update for an OTP match. Three filters apply:
 *  1. `update_id > minUpdateId` (per-fetcher floor)
 *  2. `chat.id === targetChat` (cross-chat protection)
 *  3. `reply_to_message.message_id === promptMessageId`
 *     (per-prompt isolation — Telegram Reply feature)
 *
 * The fourth filter is the digits-extraction `bankRegex` against
 * the user's reply text. Per-bank attribution is now handled by
 * the reply-id, so the regex serves only to extract the digits
 * (callers typically use `/(\d{4,8})/`).
 *
 * @param args - Bundled inspection inputs.
 * @returns Match payload or `false`.
 */
function inspectUpdate(args: IInspectArgs): MatchResult {
  if (args.upd.update_id <= args.minUpdateId) return false;
  const msg = args.upd.message;
  if (!msg) return false;
  if (msg.chat.id !== args.targetChat) return false;
  if (msg.reply_to_message?.message_id !== args.promptMessageId) return false;
  const text = msg.text ?? '';
  const match = args.bankRegex.exec(text);
  if (!match) return false;
  const captured = match[1];
  if (typeof captured !== 'string' || captured.length === 0) return false;
  return { code: captured, updateId: args.upd.update_id };
}

/**
 * Reverse-id ordering — keeps `Array.sort` stable across runtimes
 * by returning -1 / 0 / 1 instead of a raw delta.
 * @param a - Left.
 * @param b - Right.
 * @returns -1 / 0 / 1.
 */
function compareUpdateIdDesc(a: ITelegramUpdate, b: ITelegramUpdate): -1 | 0 | 1 {
  if (a.update_id > b.update_id) return -1;
  if (a.update_id < b.update_id) return 1;
  return 0;
}

/** Bundled match args. */
interface IFindOtpMatchArgs {
  readonly updates: readonly ITelegramUpdate[];
  readonly chatId: string;
  readonly bankRegex: RegExp;
  readonly minUpdateId: number;
  readonly promptMessageId: number;
}

/**
 * Walk a batch of updates newest-first and return the first one
 * that's strictly newer than `minUpdateId`, in the right chat,
 * AND a reply to our prompt (`promptMessageId`).
 * @param args - Match inputs.
 * @returns Match payload or `false`.
 */
function findOtpMatch(args: IFindOtpMatchArgs): MatchResult {
  const targetChat = Number(args.chatId);
  const ordered = [...args.updates].sort(compareUpdateIdDesc);
  for (const upd of ordered) {
    const found = inspectUpdate({
      upd,
      targetChat,
      bankRegex: args.bankRegex,
      minUpdateId: args.minUpdateId,
      promptMessageId: args.promptMessageId,
    });
    if (found !== false) return found;
  }
  return false;
}

/** Window of recent updates we ask Telegram for each cycle. */
const RECENT_WINDOW_LIMIT = 100;

/**
 * Capture the highest `update_id` currently visible on the bot,
 * read-only (`offset=-1` returns the last update without confirming
 * anything). Subsequent polls accept ONLY updates strictly greater
 * than this value — the per-fetcher floor that prevents picking up
 * stale OTPs that the chat already had.
 *
 * @param token - Bot token.
 * @returns Highest seen update_id, or 0 when chat empty.
 */
async function readInitialUpdateId(token: string): Promise<number> {
  const url = buildUpdatesUrl(token, 'offset=-1&limit=1&timeout=0');
  const res = await safeFetchUpdates(url);
  if (res === false || res.result.length === 0) return 0;
  return res.result[0].update_id;
}

/** Internal poll-loop state. */
interface IPollState {
  readonly args: ITelegramFetchArgs;
  readonly deadline: number;
  /**
   * `update_id` floor captured at fetcher start. Strict-greater-than
   * filter on every poll cycle — guarantees this fetcher never picks
   * up an OTP that arrived in the chat BEFORE this run started, and
   * never collides with a parallel fetcher's match (each parallel
   * fetcher has its own `minUpdateId` based on when IT started).
   */
  readonly minUpdateId: number;
  /**
   * The bot's prompt `message_id`. Replies to this prompt are the
   * only updates the fetcher accepts.
   */
  readonly promptMessageId: number;
}

/**
 * Compute a long-poll budget bounded by the remaining deadline.
 * @param deadline - Wall-clock deadline ms.
 * @returns Long-poll seconds in [1, TELEGRAM_LONG_POLL_S].
 */
function computeLongPollSeconds(deadline: number): number {
  const remaining = deadline - Date.now();
  const remainingSec = Math.floor(remaining / 1000);
  const flooredAtOne = Math.max(1, remainingSec);
  return Math.min(TELEGRAM_LONG_POLL_S, flooredAtOne);
}

/**
 * Single Telegram long-poll iteration. Always reads the last
 * `RECENT_WINDOW_LIMIT` updates with `offset=-N` (read-only —
 * Telegram does NOT advance the bot's confirmed cursor when offset
 * is negative). This guarantees parallel fetchers in the same
 * matrix don't accidentally purge each other's pending OTPs.
 *
 * @param state - Poll state.
 * @returns Match payload or `false`.
 */
async function pollOnce(state: IPollState): Promise<MatchResult> {
  const longPoll = computeLongPollSeconds(state.deadline);
  const offsetParam = `offset=-${String(RECENT_WINDOW_LIMIT)}`;
  const otherParams = `limit=${String(RECENT_WINDOW_LIMIT)}&timeout=${String(longPoll)}`;
  const url = buildUpdatesUrl(state.args.botToken, `${offsetParam}&${otherParams}`);
  const res = await safeFetchUpdates(url);
  if (res === false) {
    state.args.log.warn(
      { event: 'telegram.otp.fetch.error', chatIdSuffix: tailMask(state.args.chatId) },
      'Telegram getUpdates failed; continuing to poll',
    );
    return false;
  }
  return findOtpMatch({
    updates: res.result,
    chatId: state.args.chatId,
    bankRegex: state.args.bankRegex,
    minUpdateId: state.minUpdateId,
    promptMessageId: state.promptMessageId,
  });
}

/**
 * Drive the long-poll loop until match or deadline. Recursive form
 * (no `while + await`) to satisfy the project's no-await-in-loop
 * rule and keep parity with `OtpPoller.pollUntil`.
 *
 * @param state - Poll state.
 * @returns Match payload or `false` on timeout.
 */
async function runPollLoop(state: IPollState): Promise<MatchResult> {
  if (Date.now() >= state.deadline) return false;
  const match = await pollOnce(state);
  if (match !== false) return match;
  return runPollLoop(state);
}

/**
 * Fetch the next OTP from Telegram for a given bank.
 *
 * @param args - See {@link ITelegramFetchArgs}.
 * @returns Captured digits group on match, or `false` on timeout
 *   / missing config / invalid args.
 */
async function fetchOtpFromTelegram(args: ITelegramFetchArgs): Promise<string | false> {
  const skip = detectSkipReason(args);
  if (skip !== false) {
    args.log.debug({ event: 'telegram.otp.fetch.skip', reason: skip }, 'Telegram OTP tier skipped');
    return false;
  }
  // 1. Capture the per-fetcher update_id floor BEFORE the prompt
  //    is sent. With a fast SMS-to-Telegram forwarder (the CI use
  //    case described in the PR), the user's reply can land before
  //    `readInitialUpdateId` returns, which would let the floor
  //    swallow the very update we are waiting for. Reading the
  //    floor first guarantees by construction that every reply to
  //    our prompt has `update_id > minUpdateId`. Per-prompt
  //    isolation comes from the `reply_to_message.message_id ===
  //    promptMessageId` filter, not from this floor.
  const minUpdateId = await readInitialUpdateId(args.botToken);
  // 2. Send the proactive prompt and capture the bot's sent
  //    `message_id` — the value the reply-scoped filter pins on.
  const promptMessageId = await sendPromptMessage(args);
  if (promptMessageId === false) {
    args.log.warn(
      {
        event: 'telegram.otp.fetch.prompt-failed',
        chatIdSuffix: tailMask(args.chatId),
        bankName: args.bankName,
      },
      'Telegram sendMessage failed — cannot prompt user; aborting fetcher',
    );
    return false;
  }
  args.log.info(
    {
      event: 'telegram.otp.fetch.start',
      chatIdSuffix: tailMask(args.chatId),
      bankName: args.bankName,
      promptMessageId,
      minUpdateId,
      timeoutMs: args.timeoutMs,
    },
    'Telegram OTP fetch — prompt sent; polling for reply',
  );
  // 3. Poll until a reply to our prompt arrives or deadline passes.
  const state: IPollState = {
    args,
    deadline: Date.now() + args.timeoutMs,
    minUpdateId,
    promptMessageId,
  };
  const match = await runPollLoop(state);
  if (match === false) {
    args.log.warn(
      {
        event: 'telegram.otp.fetch.timeout',
        chatIdSuffix: tailMask(args.chatId),
        bankName: args.bankName,
        promptMessageId,
        waitedMs: args.timeoutMs,
      },
      'Telegram OTP fetch timed out — user did not reply within budget',
    );
    await sendAckMessage({
      botToken: args.botToken,
      chatId: args.chatId,
      text: `⚠️ *${args.bankName}* — no reply received within ${String(args.timeoutMs / 1000)}s. Re-run the pipeline to retry.`,
      replyToMessageId: promptMessageId,
    });
    return false;
  }
  args.log.info(
    {
      event: 'telegram.otp.fetch.match',
      chatIdSuffix: tailMask(args.chatId),
      bankName: args.bankName,
      promptMessageId,
      codeLength: match.code.length,
      updateId: match.updateId,
    },
    'Telegram OTP fetch — matched (reply-scoped, parallel-safe)',
  );
  await sendAckMessage({
    botToken: args.botToken,
    chatId: args.chatId,
    text: `✅ *${args.bankName}* — OTP received (${String(match.code.length)} digits). Continuing the scrape.`,
    replyToMessageId: promptMessageId,
  });
  return match.code;
}

export type { ITelegramFetchArgs };
export { fetchOtpFromTelegram };
export default fetchOtpFromTelegram;
