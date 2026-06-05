/**
 * Shared Slack utilities — signature verification, bot/retry filtering, message posting.
 * All external dependencies are injected so unit tests can stub them.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

export interface VerifySlackSignatureOpts {
  signingSecret: string;
  /** Unix epoch seconds as a string (x-slack-request-timestamp) */
  timestamp: string;
  /** Raw request body (string) */
  body: string;
  /** Value of x-slack-signature header (e.g. "v0=abc123...") */
  signature: string;
  /** Current time in epoch seconds; defaults to Date.now()/1000 when omitted */
  now?: number;
}

/**
 * Verifies the Slack request signature using HMAC-SHA256.
 * Returns true when valid, false otherwise.
 * Rejects requests older than 5 minutes (300 seconds) to prevent replay attacks.
 */
export function verifySlackSignature(opts: VerifySlackSignatureOpts): boolean {
  const { signingSecret, timestamp, body, signature } = opts;
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  // Replay-attack guard
  if (Math.abs(now - Number(timestamp)) > 300) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = `v0=${createHmac("sha256", signingSecret).update(sigBasestring).digest("hex")}`;

  // timingSafeEqual requires equal-length buffers
  const a = Buffer.from(mySignature, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Bot / retry filtering
// ---------------------------------------------------------------------------

export interface SlackEventForFilter {
  bot_id?: string;
  subtype?: string;
}

export interface SlackRetryHeaders {
  "x-slack-retry-num"?: string;
  [key: string]: string | undefined;
}

/**
 * Returns true when the event should be dropped (bot message or Slack retry).
 * - Drops if event.bot_id is present
 * - Drops if event.subtype === "bot_message"
 * - Drops if the HTTP header x-slack-retry-num is present (Slack is retrying)
 */
export function isBotOrRetryMessage(event: SlackEventForFilter | undefined, headers: SlackRetryHeaders): boolean {
  if (headers["x-slack-retry-num"] !== undefined) {
    return true;
  }
  if (event === undefined) {
    return false;
  }
  if (event.bot_id !== undefined) {
    return true;
  }
  if (event.subtype === "bot_message") {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Slack API helpers
// ---------------------------------------------------------------------------

export type FetchFn = typeof fetch;

export interface PostSlackMessageOpts {
  token: string;
  channel: string;
  text: string;
  thread_ts?: string;
  fetchFn?: FetchFn;
}

export interface SlackApiResponse {
  ok: boolean;
  ts?: string;
  error?: string;
}

/**
 * Posts a new message via chat.postMessage.
 * Returns the Slack API response JSON.
 */
export async function postSlackMessage(opts: PostSlackMessageOpts): Promise<SlackApiResponse> {
  const { token, channel, text, thread_ts, fetchFn = fetch } = opts;

  const bodyObj: { channel: string; text: string; thread_ts?: string } = { channel, text };
  if (thread_ts !== undefined) {
    bodyObj.thread_ts = thread_ts;
  }

  const res = await fetchFn("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(bodyObj),
  });

  return (await res.json()) as SlackApiResponse;
}

export interface UpdateSlackMessageOpts {
  token: string;
  channel: string;
  ts: string;
  text: string;
  fetchFn?: FetchFn;
}

/**
 * Updates an existing message via chat.update.
 * Returns the Slack API response JSON.
 */
export async function updateSlackMessage(opts: UpdateSlackMessageOpts): Promise<SlackApiResponse> {
  const { token, channel, ts, text, fetchFn = fetch } = opts;

  const res = await fetchFn("https://slack.com/api/chat.update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, ts, text }),
  });

  return (await res.json()) as SlackApiResponse;
}
