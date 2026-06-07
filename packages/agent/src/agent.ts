import { Agent, BedrockModel } from "@strands-agents/sdk";
import type { ConnpassClient } from "./connpass/client.js";
import { createConnpassSearchTool } from "./tools/connpass-search.js";

/** Bedrock AgentCore のデプロイ先 (Tokyo) に合わせた既定値。環境変数で上書き可能 */
const DEFAULT_REGION = "ap-northeast-1";

/** 「検索して要約」程度のタスクのため軽量モデルを既定とする */
const DEFAULT_MODEL_ID = "global.amazon.nova-2-lite-v1:0";

const SYSTEM_PROMPT = `あなたは connpass のイベント情報からユーザーの興味分野に合うものを探して紹介するアシスタントです。

## ルール
- ユーザーから興味分野(キーワードやハッシュタグ)を受け取ったら search_connpass_events ツールで検索してください
- 該当するイベントが見つからない場合は、その旨を伝え、別のキーワードでの検索を提案してください
- 推測でイベント情報を作り出さず、ツールの検索結果のみを根拠に回答してください
- connpass API のレート制限があるため、複数キーワードの検索は1つずつ順番に実行してください

## 出力フォーマット（Slack mrkdwn 形式）
応答は必ず以下の Slack mrkdwn 形式で出力してください:

- 各イベントは以下の形式:
  • <URL|タイトル>
  　📅 M/D HH:MM 👥 参加者/定員名
  　_description を元にイベント内容を30文字以内で要約_
- limit が null の場合は「定員なし」と表記
- waiting が 0 でない場合は「(待ちN名)」を追加
- 余計な前置きは最小限に。イベント一覧を中心に出力
- URL は Slack のリンク形式 <URL|表示テキスト> を使うこと`;

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
