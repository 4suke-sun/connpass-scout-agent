import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import type { SQSEvent, SQSRecord } from "aws-lambda";
import { mockClient } from "aws-sdk-client-mock";
import { describe, expect, it, vi } from "vitest";
import { createAgentIntegrationHandler } from "./handler.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSQSRecord(payload: object): SQSRecord {
  return {
    messageId: "msg-1",
    receiptHandle: "handle-1",
    body: JSON.stringify(payload),
    attributes: {
      ApproximateReceiveCount: "1",
      SentTimestamp: "1609459200000",
      SenderId: "123456789",
      ApproximateFirstReceiveTimestamp: "1609459200000",
    },
    messageAttributes: {},
    md5OfBody: "abc",
    eventSource: "aws:sqs",
    eventSourceARN: "arn:aws:sqs:us-east-1:123456789:test.fifo",
    awsRegion: "us-east-1",
  };
}

function makeSQSEvent(payload: object): SQSEvent {
  return { Records: [makeSQSRecord(payload)] };
}

const SAMPLE_PAYLOAD = {
  action: "chat",
  text: "AWSのイベントある？",
  scope_id: "C0123ABC",
  actor_id: "U0456DEF",
  session_id: "1609459200.0000000000000000",
  channel: "C0123ABC",
  thread_ts: "1609459200.0000000000000000",
};

function makeEnv() {
  return {
    AGENT_RUNTIME_ARN: "arn:aws:bedrock-agentcore:us-east-1:123456789:agent-runtime/agent-1",
    SLACK_BOT_TOKEN: "xoxb-test",
  };
}

// ---------------------------------------------------------------------------
// agent-integration happy path
// ---------------------------------------------------------------------------

describe("agent-integration handler", () => {
  it("happy path: posts processing message, invokes agent, updates Slack message", async () => {
    const bedrockMock = mockClient(BedrockAgentCoreClient);

    // Mock the streaming response
    const fakeStreamText = "こんなイベントがあります！";
    bedrockMock.on(InvokeAgentRuntimeCommand).resolves({
      response: {
        transformToString: async () => fakeStreamText,
      } as unknown as NonNullable<
        Awaited<ReturnType<BedrockAgentCoreClient["send"]> & { response: unknown }>["response"]
      >,
      contentType: "text/plain",
      $metadata: {},
    });

    // Capture fetch calls
    const fetchCalls: Array<{ url: string; body: string }> = [];
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      callCount++;
      fetchCalls.push({ url, body: init.body as string });
      const isPost = url.includes("postMessage");
      return {
        json: async () => ({
          ok: true,
          ts: isPost ? "1609459200.000100" : "1609459200.000100",
        }),
      };
    });

    const handler = createAgentIntegrationHandler({
      bedrockClientFactory: () => new BedrockAgentCoreClient({}),
      fetchFn: mockFetch as unknown as typeof fetch,
      env: makeEnv(),
    });

    await handler(makeSQSEvent(SAMPLE_PAYLOAD), {} as never, () => {});

    // Should have posted + updated (2 fetch calls)
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0]?.url).toBe("https://slack.com/api/chat.postMessage");
    expect(fetchCalls[1]?.url).toBe("https://slack.com/api/chat.update");

    // Verify postMessage body
    const postBody = JSON.parse(fetchCalls[0]?.body ?? "{}") as Record<string, string>;
    expect(postBody.text).toBe("🔍 処理中…");
    expect(postBody.channel).toBe("C0123ABC");

    // Verify updateMessage body has agent response
    const updateBody = JSON.parse(fetchCalls[1]?.body ?? "{}") as Record<string, string>;
    expect(updateBody.text).toBe(fakeStreamText);
    expect(updateBody.channel).toBe("C0123ABC");

    // Verify bedrock was called with correct args
    const bedrockCalls = bedrockMock.commandCalls(InvokeAgentRuntimeCommand);
    expect(bedrockCalls).toHaveLength(1);
    const cmdInput = bedrockCalls[0]?.args[0]?.input;
    expect(cmdInput?.agentRuntimeArn).toBe(makeEnv().AGENT_RUNTIME_ARN);
    expect(cmdInput?.runtimeSessionId).toBe(SAMPLE_PAYLOAD.session_id);
    // Verify payload bytes encode the chat action
    const decodedPayload = new TextDecoder().decode(cmdInput?.payload as Uint8Array);
    const parsedPayload = JSON.parse(decodedPayload) as Record<string, string>;
    expect(parsedPayload.action).toBe("chat");
    expect(parsedPayload.text).toBe(SAMPLE_PAYLOAD.text);

    expect(callCount).toBe(2);
  });

  it("uses (no response) text when agent response is empty", async () => {
    const bedrockMock = mockClient(BedrockAgentCoreClient);
    bedrockMock.on(InvokeAgentRuntimeCommand).resolves({
      response: {
        transformToString: async () => "",
      } as unknown as NonNullable<
        Awaited<ReturnType<BedrockAgentCoreClient["send"]> & { response: unknown }>["response"]
      >,
      contentType: "text/plain",
      $metadata: {},
    });

    const fetchCalls: Array<{ url: string; body: string }> = [];
    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      fetchCalls.push({ url, body: init.body as string });
      return {
        json: async () => ({ ok: true, ts: "111.222" }),
      };
    });

    const handler = createAgentIntegrationHandler({
      bedrockClientFactory: () => new BedrockAgentCoreClient({}),
      fetchFn: mockFetch as unknown as typeof fetch,
      env: makeEnv(),
    });

    await handler(makeSQSEvent(SAMPLE_PAYLOAD), {} as never, () => {});

    const updateBody = JSON.parse(fetchCalls[1]?.body ?? "{}") as Record<string, string>;
    expect(updateBody.text).toBe("(no response)");
  });

  it("handles missing response stream gracefully", async () => {
    const bedrockMock = mockClient(BedrockAgentCoreClient);
    bedrockMock.on(InvokeAgentRuntimeCommand).resolves({
      contentType: "text/plain",
      $metadata: {},
    });

    const fetchCalls: Array<{ url: string; body: string }> = [];
    const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      fetchCalls.push({ url, body: init.body as string });
      return {
        json: async () => ({ ok: true, ts: "111.222" }),
      };
    });

    const handler = createAgentIntegrationHandler({
      bedrockClientFactory: () => new BedrockAgentCoreClient({}),
      fetchFn: mockFetch as unknown as typeof fetch,
      env: makeEnv(),
    });

    await handler(makeSQSEvent(SAMPLE_PAYLOAD), {} as never, () => {});

    const updateBody = JSON.parse(fetchCalls[1]?.body ?? "{}") as Record<string, string>;
    expect(updateBody.text).toBe("(no response)");
  });
});
