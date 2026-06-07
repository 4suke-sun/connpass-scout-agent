import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

/**
 * EventBridge Scheduler から起動される Lambda ハンドラ。
 *
 * 1. SSM SecureString から Slack Bot Token を取得
 * 2. AgentCore Runtime にイベント検索プロンプトを送信
 * 3. 応答を Slack チャンネルに chat.postMessage で投稿
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません`);
  }
  return value;
}

const AGENT_RUNTIME_ARN = requireEnv("AGENT_RUNTIME_ARN");
const SLACK_BOT_TOKEN_PARAMETER = requireEnv("SLACK_BOT_TOKEN_PARAMETER");
const SLACK_CHANNEL_ID = requireEnv("SLACK_CHANNEL_ID");
const SEARCH_KEYWORDS = process.env["SEARCH_KEYWORDS"] ?? "JAWS,AWS,AI";

const ssmClient = new SSMClient({});
const agentCoreClient = new BedrockAgentCoreClient({});

let cachedSlackToken: string | undefined;

async function getSlackBotToken(): Promise<string> {
  if (cachedSlackToken) return cachedSlackToken;

  const result = await ssmClient.send(
    new GetParameterCommand({
      Name: SLACK_BOT_TOKEN_PARAMETER,
      WithDecryption: true,
    }),
  );

  const token = result.Parameter?.Value;
  if (!token) {
    throw new Error(`SSM パラメータ ${SLACK_BOT_TOKEN_PARAMETER} の値が空です`);
  }

  cachedSlackToken = token;
  return token;
}

function buildSearchPrompt(keywords: string): string {
  const keywordList = keywords
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  return [
    `以下のキーワードに関連する今後開催予定の connpass イベントを検索してください: ${keywordList.join("、")}`,
    "",
    "それぞれのキーワードで検索し、見つかったイベントをまとめて紹介してください。",
    "各イベントについて、タイトル・開催日時・開催場所・参加者数・URL を箇条書きで提示してください。",
  ].join("\n");
}

async function invokeAgent(prompt: string): Promise<string> {
  const payload = JSON.stringify({ prompt });

  const command = new InvokeAgentRuntimeCommand({
    agentRuntimeArn: AGENT_RUNTIME_ARN,
    payload: new TextEncoder().encode(payload),
    contentType: "application/json",
    accept: "application/json",
  });

  const response = await agentCoreClient.send(command);

  if (!response.response) {
    throw new Error("AgentCore Runtime からのレスポンスが空です");
  }

  // SdkStream の transformToString() でレスポンスボディを文字列化する
  const responseBody = await response.response.transformToString();
  const parsed = JSON.parse(responseBody) as { reply?: string };

  if (!parsed.reply) {
    throw new Error("AgentCore Runtime レスポンスに reply フィールドがありません");
  }

  return parsed.reply;
}

async function postToSlack(token: string, channel: string, text: string): Promise<void> {
  const body = JSON.stringify({ channel, text });

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Slack API HTTP エラー: ${res.status} ${res.statusText}`);
  }

  const result = (await res.json()) as { ok: boolean; error?: string };
  if (!result.ok) {
    throw new Error(`Slack API エラー: ${result.error ?? "unknown"}`);
  }
}

export async function handler(): Promise<{ statusCode: number; body: string }> {
  console.info("scheduler handler invoked", {
    agentRuntimeArn: AGENT_RUNTIME_ARN,
    slackChannel: SLACK_CHANNEL_ID,
    keywords: SEARCH_KEYWORDS,
  });

  try {
    const slackToken = await getSlackBotToken();
    const prompt = buildSearchPrompt(SEARCH_KEYWORDS);
    const agentReply = await invokeAgent(prompt);

    const header = "🔍 *connpass イベント ダイジェスト*\n\n";
    await postToSlack(slackToken, SLACK_CHANNEL_ID, header + agentReply);

    console.info("Slack 投稿完了");
    return { statusCode: 200, body: "OK" };
  } catch (error) {
    console.error("scheduler handler error", error);
    throw error;
  }
}
