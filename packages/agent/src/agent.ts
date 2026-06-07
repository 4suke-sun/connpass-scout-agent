import { Agent, BedrockModel } from "@strands-agents/sdk";
import type { ConnpassClient } from "./connpass/client.js";
import { createConnpassSearchTool } from "./tools/connpass-search.js";

/** Bedrock AgentCore のデプロイ先 (Tokyo) に合わせた既定値。環境変数で上書き可能 */
const DEFAULT_REGION = "ap-northeast-1";

/** 「検索して要約」程度のタスクのため軽量モデルを既定とする */
const DEFAULT_MODEL_ID = "global.amazon.nova-2-lite-v1:0";

const SYSTEM_PROMPT = `あなたは connpass のイベント情報からユーザーの興味分野に合うものを探して紹介するアシスタントです。

- ユーザーから興味分野(キーワードやハッシュタグ)を受け取ったら search_connpass_events ツールで検索してください
- 検索結果は日本語で簡潔に要約し、各イベントについてタイトル・開催日時・開催場所・参加者数・URL を箇条書きで提示してください
- 該当するイベントが見つからない場合は、その旨を伝え、別のキーワードでの検索を提案してください
- 推測でイベント情報を作り出さず、ツールの検索結果のみを根拠に回答してください`;

export interface ConnpassScoutAgentOptions {
  connpassClient: ConnpassClient;
  modelId?: string;
  region?: string;
}

export function createConnpassScoutAgent(options: ConnpassScoutAgentOptions): Agent {
  return new Agent({
    name: "connpass-scout-agent",
    description: "connpass のイベントを興味分野で検索し、日本語で要約して提示するエージェント",
    model: new BedrockModel({
      modelId: options.modelId ?? DEFAULT_MODEL_ID,
      region: options.region ?? DEFAULT_REGION,
    }),
    systemPrompt: SYSTEM_PROMPT,
    tools: [createConnpassSearchTool(options.connpassClient)],
  });
}
