/**
 * verification lambda — API Gateway REST (v1) proxy handler.
 *
 * Responsibilities per §6:
 *  1. Verify Slack HMAC-SHA256 signature + 5-min replay guard.
 *  2. Handle url_verification: return 200 { challenge }.
 *  3. Drop bot / retry messages → 200 noop.
 *  4. Enqueue to SQS FIFO (MessageGroupId=channel, MessageDeduplicationId=event_id|event_ts).
 *  5. Return 200 fast.
 */
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import { isBotOrRetryMessage, verifySlackSignature } from "../shared/slack.js";
import type { AgentChatPayload, SlackEventEnvelope, SlackRequestHeaders } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Session ID helper (§2: >=33 chars)
// ---------------------------------------------------------------------------

/** Pads a Slack thread timestamp so runtimeSessionId meets AgentCore's >=33 char minimum. */
export function toSessionId(ts: string): string {
  const MIN_LEN = 33;
  if (ts.length >= MIN_LEN) {
    return ts;
  }
  return ts.padEnd(MIN_LEN, "0");
}

// ---------------------------------------------------------------------------
// Injected SQS client factory (allows test injection)
// ---------------------------------------------------------------------------

export type SQSClientFactory = () => SQSClient;

const defaultSQSClientFactory: SQSClientFactory = () => new SQSClient({});

// ---------------------------------------------------------------------------
// Handler factory (DI for tests)
// ---------------------------------------------------------------------------

export interface VerificationHandlerDeps {
  sqsClientFactory?: SQSClientFactory;
  env?: {
    SLACK_SIGNING_SECRET?: string;
    SQS_QUEUE_URL?: string;
    SLACK_BOT_TOKEN?: string;
  };
}

function ok(body: unknown): APIGatewayProxyResult {
  return { statusCode: 200, body: JSON.stringify(body) };
}

function unauthorized(): APIGatewayProxyResult {
  return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
}

export function createVerificationHandler(deps: VerificationHandlerDeps = {}): APIGatewayProxyHandler {
  const sqsFactory = deps.sqsClientFactory ?? defaultSQSClientFactory;
  const env = deps.env ?? (process.env as Record<string, string | undefined>);

  return async (event) => {
    const signingSecret = env.SLACK_SIGNING_SECRET ?? "";
    const sqsQueueUrl = env.SQS_QUEUE_URL ?? "";

    // ---- Extract raw body (handle base64 encoding from API GW) ----
    let rawBody: string;
    if (event.isBase64Encoded && event.body !== null && event.body !== undefined) {
      rawBody = Buffer.from(event.body, "base64").toString("utf-8");
    } else {
      rawBody = event.body ?? "";
    }

    // ---- Normalize headers to lowercase keys ----
    const headers: SlackRequestHeaders = {};
    for (const [k, v] of Object.entries(event.headers ?? {})) {
      if (v !== undefined) {
        headers[k.toLowerCase()] = v;
      }
    }

    const timestamp = headers["x-slack-request-timestamp"] ?? "";
    const signature = headers["x-slack-signature"] ?? "";

    // ---- Signature verification ----
    const valid = verifySlackSignature({
      signingSecret,
      timestamp,
      body: rawBody,
      signature,
    });

    if (!valid) {
      return unauthorized();
    }

    // ---- Parse body ----
    let envelope: SlackEventEnvelope;
    try {
      envelope = JSON.parse(rawBody) as SlackEventEnvelope;
    } catch {
      return ok({ status: "ignored", reason: "parse_error" });
    }

    // ---- url_verification challenge ----
    if (envelope.type === "url_verification") {
      return ok({ challenge: envelope.challenge });
    }

    // ---- Drop bot / retry ----
    if (isBotOrRetryMessage(envelope.event, headers)) {
      return ok({ status: "ignored", reason: "bot_or_retry" });
    }

    // ---- Build SQS payload ----
    const slackEvent = envelope.event;
    if (slackEvent === undefined) {
      return ok({ status: "ignored", reason: "no_event" });
    }

    const channel = slackEvent.channel ?? envelope.team_id ?? "unknown";
    const deduplicationId = envelope.event_id ?? slackEvent.event_ts ?? slackEvent.ts;
    const threadTs = slackEvent.thread_ts ?? slackEvent.ts;
    const sessionId = toSessionId(threadTs);

    const chatPayload: AgentChatPayload = {
      action: "chat",
      text: slackEvent.text ?? "",
      scope_id: channel,
      actor_id: slackEvent.user ?? "unknown",
      session_id: sessionId,
      channel,
      thread_ts: threadTs,
    };

    const sqsClient = sqsFactory();
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: sqsQueueUrl,
        MessageBody: JSON.stringify(chatPayload),
        MessageGroupId: channel,
        MessageDeduplicationId: deduplicationId,
      }),
    );

    return ok({ status: "queued" });
  };
}

/** Default exported handler — uses environment variables */
export const handler: APIGatewayProxyHandler = createVerificationHandler();
