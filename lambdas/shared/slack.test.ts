import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { isBotOrRetryMessage, postSlackMessage, updateSlackMessage, verifySlackSignature } from "./slack.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSignature(secret: string, timestamp: string, body: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

const SECRET = "test-signing-secret";
const TIMESTAMP = "1609459200"; // 2021-01-01 00:00:00 UTC
const BODY = '{"type":"event_callback"}';

// ---------------------------------------------------------------------------
// verifySlackSignature
// ---------------------------------------------------------------------------

describe("verifySlackSignature", () => {
  it("accepts a valid signature", () => {
    const sig = makeSignature(SECRET, TIMESTAMP, BODY);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: TIMESTAMP,
        body: BODY,
        signature: sig,
        now: Number(TIMESTAMP),
      }),
    ).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const sig = makeSignature(SECRET, TIMESTAMP, BODY);
    const tampered = `${sig.slice(0, -4)}0000`;
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: TIMESTAMP,
        body: BODY,
        signature: tampered,
        now: Number(TIMESTAMP),
      }),
    ).toBe(false);
  });

  it("rejects when replay window > 300s", () => {
    const sig = makeSignature(SECRET, TIMESTAMP, BODY);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: TIMESTAMP,
        body: BODY,
        signature: sig,
        now: Number(TIMESTAMP) + 301,
      }),
    ).toBe(false);
  });

  it("accepts when within the 300s window (exactly 300s)", () => {
    const sig = makeSignature(SECRET, TIMESTAMP, BODY);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: TIMESTAMP,
        body: BODY,
        signature: sig,
        now: Number(TIMESTAMP) + 300,
      }),
    ).toBe(true);
  });

  it("rejects when timestamp is in the future (> 300s)", () => {
    const sig = makeSignature(SECRET, TIMESTAMP, BODY);
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: TIMESTAMP,
        body: BODY,
        signature: sig,
        now: Number(TIMESTAMP) - 301,
      }),
    ).toBe(false);
  });

  it("rejects when signature length differs (different secret)", () => {
    const sig = makeSignature("other-secret-with-different-hmac-length-output", TIMESTAMP, BODY);
    // The lengths of the hex HMAC strings should be the same (both 64 hex chars + "v0=")
    // but wrong secret produces different value
    expect(
      verifySlackSignature({
        signingSecret: SECRET,
        timestamp: TIMESTAMP,
        body: BODY,
        signature: sig,
        now: Number(TIMESTAMP),
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isBotOrRetryMessage
// ---------------------------------------------------------------------------

describe("isBotOrRetryMessage", () => {
  it("drops when x-slack-retry-num header is present", () => {
    expect(isBotOrRetryMessage(undefined, { "x-slack-retry-num": "1" })).toBe(true);
  });

  it("drops when event.bot_id is set", () => {
    expect(isBotOrRetryMessage({ bot_id: "B123" }, {})).toBe(true);
  });

  it("drops when event.subtype === bot_message", () => {
    expect(isBotOrRetryMessage({ subtype: "bot_message" }, {})).toBe(true);
  });

  it("passes normal user messages", () => {
    expect(isBotOrRetryMessage({ subtype: undefined }, {})).toBe(false);
  });

  it("passes when event is undefined and no retry header", () => {
    expect(isBotOrRetryMessage(undefined, {})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// postSlackMessage / updateSlackMessage
// ---------------------------------------------------------------------------

describe("postSlackMessage", () => {
  it("calls chat.postMessage with correct args and returns ts", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, ts: "111.222" }),
    });

    const res = await postSlackMessage({
      token: "xoxb-test",
      channel: "C001",
      text: "Hello",
      thread_ts: "111.000",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(res.ok).toBe(true);
    expect(res.ts).toBe("111.222");
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer xoxb-test");
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.channel).toBe("C001");
    expect(body.thread_ts).toBe("111.000");
  });

  it("omits thread_ts when not provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, ts: "222.333" }),
    });

    await postSlackMessage({
      token: "xoxb-test",
      channel: "C002",
      text: "No thread",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.thread_ts).toBeUndefined();
  });
});

describe("updateSlackMessage", () => {
  it("calls chat.update with correct args", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, ts: "111.222" }),
    });

    const res = await updateSlackMessage({
      token: "xoxb-test",
      channel: "C001",
      ts: "111.222",
      text: "Updated text",
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(res.ok).toBe(true);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://slack.com/api/chat.update");
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.ts).toBe("111.222");
    expect(body.text).toBe("Updated text");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer xoxb-test");
  });
});
