/**
 * agent-integration lambda — SQS trigger handler.
 *
 * Responsibilities per §6:
 *  1. Parse AgentChatPayload from each SQS record.
 *  2. Post "🔍 処理中…" to Slack, capture ts.
 *  3. Call InvokeAgentRuntimeCommand with the chat payload.
 *  4. Decode the streaming response to text.
 *  5. Update the Slack message with the response text.
 */
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import type { SQSHandler } from "aws-lambda";
import type { FetchFn } from "../shared/slack.js";
import { postSlackMessage, updateSlackMessage } from "../shared/slack.js";
import type { AgentChatPayload } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Injected client factories + fetch (DI for tests)
// ---------------------------------------------------------------------------

export type BedrockClientFactory = () => BedrockAgentCoreClient;

const defaultBedrockClientFactory: BedrockClientFactory = () => new BedrockAgentCoreClient({});

export interface AgentIntegrationHandlerDeps {
  bedrockClientFactory?: BedrockClientFactory;
  fetchFn?: FetchFn;
  env?: {
    AGENT_RUNTIME_ARN?: string;
    SLACK_BOT_TOKEN?: string;
  };
}

// ---------------------------------------------------------------------------
// Handler factory (DI for tests)
// ---------------------------------------------------------------------------

export function createAgentIntegrationHandler(deps: AgentIntegrationHandlerDeps = {}): SQSHandler {
  const bedrockFactory = deps.bedrockClientFactory ?? defaultBedrockClientFactory;
  const fetchFn = deps.fetchFn ?? fetch;
  const env = deps.env ?? (process.env as Record<string, string | undefined>);

  return async (event) => {
    for (const record of event.Records) {
      const payload = JSON.parse(record.body) as AgentChatPayload;
      const { channel, thread_ts, text, scope_id, actor_id, session_id } = payload;

      const agentRuntimeArn = env.AGENT_RUNTIME_ARN ?? "";
      const slackToken = env.SLACK_BOT_TOKEN ?? "";

      // ---- 1. Post "処理中…" ----
      const postRes = await postSlackMessage({
        token: slackToken,
        channel,
        text: "🔍 処理中…",
        thread_ts,
        fetchFn,
      });

      const processingTs = postRes.ts ?? thread_ts;

      // ---- 2. Build AgentCore payload ----
      const agentPayload: {
        action: string;
        text: string;
        scope_id: string;
        actor_id: string;
        session_id: string;
      } = {
        action: "chat",
        text,
        scope_id,
        actor_id,
        session_id,
      };

      const payloadBytes = new TextEncoder().encode(JSON.stringify(agentPayload));

      // ---- 3. Invoke AgentCore Runtime ----
      const bedrockClient = bedrockFactory();
      const invokeRes = await bedrockClient.send(
        new InvokeAgentRuntimeCommand({
          agentRuntimeArn,
          runtimeSessionId: session_id,
          payload: payloadBytes,
        }),
      );

      // ---- 4. Decode streaming response ----
      let responseText = "";
      if (invokeRes.response !== undefined) {
        responseText = await invokeRes.response.transformToString("utf-8");
      }

      // ---- 5. Update Slack message ----
      await updateSlackMessage({
        token: slackToken,
        channel,
        ts: processingTs,
        text: responseText || "(no response)",
        fetchFn,
      });
    }
  };
}

/** Default exported handler — uses environment variables */
export const handler: SQSHandler = createAgentIntegrationHandler();
