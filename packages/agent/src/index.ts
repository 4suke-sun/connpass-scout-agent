import { TextBlock, type AgentResult, type Message } from "@strands-agents/sdk";
import { BedrockAgentCoreApp } from "bedrock-agentcore/runtime";
import { z } from "zod";
import { createConnpassScoutAgent } from "./agent.js";
import { createConnpassClient } from "./connpass/client.js";

const DEFAULT_USER_AGENT = "connpass-scout-agent (+https://github.com/4suke-sun/connpass-scout-agent)";

const requestSchema = z.object({
  prompt: z.string().min(1).describe("ユーザーからの問い合わせ文(例: 「TypeScriptの勉強会を探して」)"),
});

/**
 * 必須環境変数を取得する。値は SSM Parameter Store 等から注入され、
 * ソースには実際の認証情報を一切書かない(OSSとして公開するため)。
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません`);
  }
  return value;
}

function extractReplyText(message: Message): string {
  return message.content
    .filter((block): block is TextBlock => block instanceof TextBlock)
    .map((block) => block.text)
    .join("");
}

const connpassClient = createConnpassClient({
  apiKey: requireEnv("CONNPASS_API_KEY"),
  userAgent: process.env["CONNPASS_USER_AGENT"] ?? DEFAULT_USER_AGENT,
});

const agent = createConnpassScoutAgent({
  connpassClient,
  ...(process.env["BEDROCK_MODEL_ID"] !== undefined ? { modelId: process.env["BEDROCK_MODEL_ID"] } : {}),
  ...(process.env["BEDROCK_REGION"] !== undefined ? { region: process.env["BEDROCK_REGION"] } : {}),
});

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    requestSchema,
    process: async (request, context) => {
      context.log.info({ sessionId: context.sessionId }, "connpass-scout-agent: invocation received");
      const result: AgentResult = await agent.invoke(request.prompt);
      return { reply: extractReplyText(result.lastMessage) };
    },
  },
});

app.run();
