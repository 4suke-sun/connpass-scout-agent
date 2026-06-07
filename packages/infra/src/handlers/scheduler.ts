import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

/**
 * EventBridge Scheduler から起動される Lambda ハンドラ。
 *
 * 1. SSM SecureString から Slack Bot Token を取得
 * 2. Slack に「検索中...」プレースホルダーを投稿
 * 3. AgentCore Runtime にイベント検索プロンプトを送信
 * 4. 応答で Slack メッセージを chat.update で差し替え（擬似ストリーミング）
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

  const today = new Date();
  const oneMonthLater = new Date(today);
  oneMonthLater.setMonth(oneMonthLater.getMonth() + 1);
  const todayStr = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;
  const endStr = `${oneMonthLater.getFullYear()}/${oneMonthLater.getMonth() + 1}/${oneMonthLater.getDate()}`;

  return [
    "あなたは毎朝の connpass イベントダイジェストを作成するアシスタントです。",
    "",
    `以下のキーワードで connpass イベントを検索してください: ${keywordList.join("、")}`,
    "",
    "【重要なルール】",
    "- connpass API のレート制限(1リクエスト/秒)があるため、検索は1つずつ順番に実行すること",
    `- 今日は ${todayStr} です。${todayStr} 〜 ${endStr} の期間に開催されるイベントのみ紹介すること`,
    "- 検索結果の順番(開催日時が近い順)をそのまま維持すること。並び替えないこと",
    "- 各キーワード上位3件まで",
    "",
    "検索結果のフィールド: title, catchCopy(概要), description(イベント説明文・要約の主な材料), url, startedAt, accepted(参加確定数), limit(定員/nullは無制限), waiting(キャンセル待ち数)",
    "",
    "以下の Slack mrkdwn 形式で出力してください:",
    "",
    "*🔍 キーワード名*",
    "• <URL|タイトル>",
    "　📅 M/D HH:MM 👥 accepted/limit名 (待ちN名)",
    "　_description を元にイベント内容を30文字以内で要約_",
    "",
    "- limit が null の場合は「定員なし」と表記",
    "- waiting が 0 の場合は「(待ちN名)」を省略",
    "- キャッチコピーも description も空の場合は要約行を省略",
    "- 該当期間内にイベントがない場合は「該当なし」と記載",
    "- 余計な前置きや締めの文は不要。一覧のみ出力",
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

  const responseBody = await response.response.transformToString();
  const parsed = JSON.parse(responseBody) as { reply?: string };

  if (!parsed.reply) {
    throw new Error("AgentCore Runtime レスポンスに reply フィールドがありません");
  }

  return parsed.reply;
}

interface SlackPostResult {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

async function postToSlack(token: string, channel: string, mrkdwn: string): Promise<SlackPostResult> {
  const body = JSON.stringify({
    channel,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: mrkdwn },
      },
    ],
    // fallback text for notifications
    text: "connpass イベント ダイジェスト",
  });

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

  const result = (await res.json()) as SlackPostResult;
  if (!result.ok) {
    throw new Error(`Slack API エラー: ${result.error ?? "unknown"}`);
  }

  return result;
}

async function updateSlackMessage(token: string, channel: string, ts: string, mrkdwn: string): Promise<void> {
  const body = JSON.stringify({
    channel,
    ts,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: mrkdwn },
      },
    ],
    text: "connpass イベント ダイジェスト",
  });

  const res = await fetch("https://slack.com/api/chat.update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Slack chat.update HTTP エラー: ${res.status} ${res.statusText}`);
  }

  const result = (await res.json()) as { ok: boolean; error?: string };
  if (!result.ok) {
    throw new Error(`Slack chat.update エラー: ${result.error ?? "unknown"}`);
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

    // 1. 「検索中...」プレースホルダーを投稿
    const placeholder = "🔍 *connpass イベント ダイジェスト*\n\n⏳ イベントを検索中です...";
    const posted = await postToSlack(slackToken, SLACK_CHANNEL_ID, placeholder);

    // 2. AgentCore Runtime に検索を依頼
    const prompt = buildSearchPrompt(SEARCH_KEYWORDS);
    const agentReply = await invokeAgent(prompt);

    // 3. メッセージを検索結果で差し替え
    const finalMessage = `🔍 *connpass イベント ダイジェスト*\n\n${agentReply}`;

    if (posted.ts && posted.channel) {
      await updateSlackMessage(slackToken, posted.channel, posted.ts, finalMessage);
    } else {
      // ts が取れなかった場合は新規投稿にフォールバック
      await postToSlack(slackToken, SLACK_CHANNEL_ID, finalMessage);
    }

    console.info("Slack 投稿完了");
    return { statusCode: 200, body: "OK" };
  } catch (error) {
    console.error("scheduler handler error", error);
    throw error;
  }
}
