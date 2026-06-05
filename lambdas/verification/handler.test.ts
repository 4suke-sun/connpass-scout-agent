import { createHmac } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { describe, expect, it } from "vitest";
import { createVerificationHandler, toSessionId } from "./handler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET = "slack-signing-secret";
const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789/test-queue.fifo";

function makeSignature(secret: string, timestamp: string, body: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

function makeEvent(
  body: string,
  timestamp: string,
  signature: string,
  extra: Partial<APIGatewayProxyEvent> = {},
): APIGatewayProxyEvent {
  return {
    body,
    headers: {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/slack/events",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent["requestContext"],
    resource: "",
    ...extra,
  };
}

const NOW = 1609459200; // fixed epoch

function makeEnv() {
  return {
    SLACK_SIGNING_SECRET: SECRET,
    SQS_QUEUE_URL: QUEUE_URL,
    SLACK_BOT_TOKEN: "xoxb-test",
  };
}

// ---------------------------------------------------------------------------
// toSessionId
// ---------------------------------------------------------------------------

describe("toSessionId", () => {
  it("pads short ts to at least 33 chars", () => {
    const result = toSessionId("1609459200.123456");
    expect(result.length).toBeGreaterThanOrEqual(33);
    expect(result).toBe(`1609459200.123456${"0".repeat(33 - "1609459200.123456".length)}`);
  });

  it("leaves ts unchanged when already >= 33 chars", () => {
    const long = "1609459200.123456789012345678901234";
    expect(toSessionId(long)).toBe(long);
    expect(toSessionId(long).length).toBeGreaterThanOrEqual(33);
  });

  it("pads exactly to 33 when ts length is 32", () => {
    const ts = "1".repeat(32);
    const result = toSessionId(ts);
    expect(result.length).toBe(33);
    expect(result).toBe(`${ts}0`);
  });
});

// ---------------------------------------------------------------------------
// verification handler
// ---------------------------------------------------------------------------

describe("verification handler", () => {
  function makeHandler() {
    const sqsMock = mockClient(SQSClient);
    sqsMock.on(SendMessageCommand).resolves({ MessageId: "msg-1" });

    const handler = createVerificationHandler({
      sqsClientFactory: () => new SQSClient({}),
      env: makeEnv(),
    });

    return { handler, sqsMock };
  }

  it("returns 401 for invalid signature", async () => {
    const { handler } = makeHandler();
    const body = '{"type":"event_callback"}';
    const event = makeEvent(body, String(NOW), "v0=badsig");
    const res = await handler(event, {} as never, () => {});
    expect(res).toBeDefined();
    if (res) {
      expect(res.statusCode).toBe(401);
    }
  });

  it("returns 401 when replay window > 300s", async () => {
    const { handler } = makeHandler();
    const body = '{"type":"event_callback"}';
    const staleTimestamp = String(NOW - 400);
    const sig = makeSignature(SECRET, staleTimestamp, body);
    const event = makeEvent(body, staleTimestamp, sig);
    const res = await handler(event, {} as never, () => {});
    expect(res).toBeDefined();
    if (res) {
      expect(res.statusCode).toBe(401);
    }
  });

  it("returns challenge for url_verification", async () => {
    const { handler } = makeHandler();
    const body = JSON.stringify({ type: "url_verification", challenge: "test_challenge_xyz" });
    const timestamp = String(NOW);
    const sig = makeSignature(SECRET, timestamp, body);
    const _event = makeEvent(body, timestamp, sig);

    // Use a fixed 'now' — but we can't inject it here since we're using the handler directly.
    // We need to use a very recent timestamp relative to actual time.
    const actualNow = Math.floor(Date.now() / 1000);
    const freshTimestamp = String(actualNow);
    const freshSig = makeSignature(SECRET, freshTimestamp, body);
    const freshEvent = makeEvent(body, freshTimestamp, freshSig);

    const res = await handler(freshEvent, {} as never, () => {});
    expect(res).toBeDefined();
    if (res) {
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body) as Record<string, string>;
      expect(parsed.challenge).toBe("test_challenge_xyz");
    }
  });

  it("drops bot message (no SQS send)", async () => {
    const { handler, sqsMock } = makeHandler();
    const body = JSON.stringify({
      type: "event_callback",
      event_id: "Ev001",
      event: {
        type: "message",
        bot_id: "B123",
        ts: "1609459200.000001",
        channel: "C001",
        text: "bot says hello",
      },
    });
    const actualNow = Math.floor(Date.now() / 1000);
    const ts = String(actualNow);
    const sig = makeSignature(SECRET, ts, body);
    const event = makeEvent(body, ts, sig);

    const res = await handler(event, {} as never, () => {});
    expect(res).toBeDefined();
    if (res) {
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body) as Record<string, string>;
      expect(parsed.status).toBe("ignored");
    }
    // SQS should NOT have been called
    const calls = sqsMock.commandCalls(SendMessageCommand);
    expect(calls).toHaveLength(0);
  });

  it("drops Slack retry (x-slack-retry-num header)", async () => {
    const { handler, sqsMock } = makeHandler();
    const body = JSON.stringify({
      type: "event_callback",
      event_id: "Ev002",
      event: {
        type: "message",
        ts: "1609459200.000002",
        channel: "C001",
        text: "retry message",
        user: "U001",
      },
    });
    const actualNow = Math.floor(Date.now() / 1000);
    const ts = String(actualNow);
    const sig = makeSignature(SECRET, ts, body);
    const event = makeEvent(body, ts, sig, {
      headers: {
        "x-slack-request-timestamp": ts,
        "x-slack-signature": sig,
        "x-slack-retry-num": "1",
      },
    });

    const res = await handler(event, {} as never, () => {});
    expect(res).toBeDefined();
    if (res) {
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body) as Record<string, string>;
      expect(parsed.status).toBe("ignored");
    }
    const calls = sqsMock.commandCalls(SendMessageCommand);
    expect(calls).toHaveLength(0);
  });

  it("sends correct SQS FIFO params for valid event", async () => {
    const { handler, sqsMock } = makeHandler();
    const body = JSON.stringify({
      type: "event_callback",
      event_id: "Ev003",
      event: {
        type: "message",
        ts: "1609459200.000003",
        channel: "C001",
        text: "hello from user",
        user: "U001",
      },
    });
    const actualNow = Math.floor(Date.now() / 1000);
    const ts = String(actualNow);
    const sig = makeSignature(SECRET, ts, body);
    const event = makeEvent(body, ts, sig);

    const res = await handler(event, {} as never, () => {});
    expect(res).toBeDefined();
    if (res) {
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body) as Record<string, string>;
      expect(parsed.status).toBe("queued");
    }

    const calls = sqsMock.commandCalls(SendMessageCommand);
    expect(calls).toHaveLength(1);
    const cmdInput = calls[0]?.args[0]?.input;
    expect(cmdInput?.QueueUrl).toBe(QUEUE_URL);
    // MessageGroupId should be the channel
    expect(cmdInput?.MessageGroupId).toBe("C001");
    // MessageDeduplicationId should be event_id
    expect(cmdInput?.MessageDeduplicationId).toBe("Ev003");
  });

  it("handles base64-encoded body correctly", async () => {
    const { handler, sqsMock } = makeHandler();
    const rawBody = JSON.stringify({
      type: "event_callback",
      event_id: "Ev004",
      event: {
        type: "message",
        ts: "1609459200.000004",
        channel: "C002",
        text: "base64 event",
        user: "U002",
      },
    });
    const b64Body = Buffer.from(rawBody).toString("base64");
    const actualNow = Math.floor(Date.now() / 1000);
    const ts = String(actualNow);
    // Signature must be over the raw (decoded) body
    const sig = makeSignature(SECRET, ts, rawBody);

    const event = makeEvent(b64Body, ts, sig, { isBase64Encoded: true });

    const res = await handler(event, {} as never, () => {});
    expect(res).toBeDefined();
    if (res) {
      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body) as Record<string, string>;
      expect(parsed.status).toBe("queued");
    }

    const calls = sqsMock.commandCalls(SendMessageCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[0]?.input?.MessageGroupId).toBe("C002");
  });
});
