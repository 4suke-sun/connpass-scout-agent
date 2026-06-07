import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import type { SQSEvent } from "aws-lambda";

/**
 * SQS から Slack イベントを受け取り、AgentCore Runtime を呼び出して
 * Slack スレッドに返信する Lambda ハンドラ。
 *
 * sessionId として Slack の thread_ts を使い、スレッド内での会話継続性を実現する。
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

function stripMention(text: string): string {
  // <@U12345678> のようなメンション部分を除去してプロンプトを抽出
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

async function invokeAgent(prompt: string, sessionId: string): Promise<string> {
  const payload = JSON.stringify({ prompt });

  const command = new InvokeAgentRuntimeCommand({
    agentRuntimeArn: AGENT_RUNTIME_ARN,
    payload: new TextEncoder().encode(payload),
    contentType: "application/json",
    accept: "application/json",
    runtimeSessionId: sessionId,
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

async function postToSlackThread(token: string, channel: string, threadTs: string, text: string): Promise<void> {
  const body = JSON.stringify({
    channel,
    thread_ts: threadTs,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
    ],
    text, // fallback for notifications
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

  const result = (await res.json()) as { ok: boolean; error?: string };
  if (!result.ok) {
    throw new Error(`Slack API エラー: ${result.error ?? "unknown"}`);
  }
}

interface SlackMessage {
  text: string;
  user: string;
  channel: string;
  threadTs: string;
}

export async function handler(event: SQSEvent): Promise<void> {
  const slackToken = await getSlackBotToken();

  for (const record of event.Records) {
    const message = JSON.parse(record.body) as SlackMessage;

    console.info("Processing Slack message", {
      user: message.user,
      channel: message.channel,
      threadTs: message.threadTs,
    });

    try {
      const prompt = stripMention(message.text);

      if (!prompt) {
        await postToSlackThread(
          slackToken,
          message.channel,
          message.threadTs,
          "検索したいキーワードを教えてください（例: `@connpass-scout TypeScript 勉強会`）",
        );
        continue;
      }

      // thread_ts をセッション ID として使い、スレッド内で会話を継続
      // AgentCore の runtimeSessionId は 33文字以上必要なため、固定プレフィックスで長さを確保
      const sessionId = `connpass-scout-slack-thread-${message.threadTs.replace(".", "-")}`.padEnd(33, "0");

      const agentReply = await invokeAgent(prompt, sessionId);
      await postToSlackThread(slackToken, message.channel, message.threadTs, agentReply);
    } catch (error) {
      console.error("メッセージ処理エラー", { error, message });
      await postToSlackThread(
        slackToken,
        message.channel,
        message.threadTs,
        "⚠️ エラーが発生しました。しばらく時間をおいて再度お試しください。",
      );
    }
  }
}
