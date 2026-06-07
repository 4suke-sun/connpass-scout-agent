import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Slack Event API の受信エンドポイント Lambda。
 *
 * 責務:
 * 1. Slack リクエスト署名の HMAC-SHA256 検証
 * 2. url_verification チャレンジへの応答
 * 3. app_mention イベントを SQS へ enqueue（3秒以内に 200 返却）
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません`);
  }
  return value;
}

const SIGNING_SECRET_PARAMETER = requireEnv("SLACK_SIGNING_SECRET_PARAMETER");
const QUEUE_URL = requireEnv("QUEUE_URL");

const ssmClient = new SSMClient({});
const sqsClient = new SQSClient({});

let cachedSigningSecret: string | undefined;

async function getSigningSecret(): Promise<string> {
  if (cachedSigningSecret) return cachedSigningSecret;

  const result = await ssmClient.send(
    new GetParameterCommand({
      Name: SIGNING_SECRET_PARAMETER,
      WithDecryption: true,
    }),
  );

  const secret = result.Parameter?.Value;
  if (!secret) {
    throw new Error(`SSM パラメータ ${SIGNING_SECRET_PARAMETER} の値が空です`);
  }

  cachedSigningSecret = secret;
  return secret;
}

function verifySlackSignature(signingSecret: string, signature: string, timestamp: string, body: string): boolean {
  // リプレイ攻撃防止: 5分以上前のリクエストは拒否
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = `v0=${createHmac("sha256", signingSecret).update(sigBasestring).digest("hex")}`;

  return timingSafeEqual(Buffer.from(mySignature, "utf-8"), Buffer.from(signature, "utf-8"));
}

interface ApiGatewayEvent {
  headers: Record<string, string | undefined>;
  body: string | null;
  isBase64Encoded?: boolean;
}

interface ApiGatewayResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

interface SlackEvent {
  type: string;
  challenge?: string;
  event?: {
    type: string;
    text: string;
    user: string;
    channel: string;
    ts: string;
    thread_ts?: string;
  };
}

export async function handler(event: ApiGatewayEvent): Promise<ApiGatewayResponse> {
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf-8")
    : (event.body ?? "");

  // ヘッダーは小文字正規化（API Gateway v2 は小文字で渡す）
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(event.headers)) {
    if (value) headers[key.toLowerCase()] = value;
  }

  const timestamp = headers["x-slack-request-timestamp"] ?? "";
  const signature = headers["x-slack-signature"] ?? "";

  // 署名検証
  const signingSecret = await getSigningSecret();
  if (!verifySlackSignature(signingSecret, signature, timestamp, rawBody)) {
    console.error("Slack 署名検証失敗");
    return { statusCode: 401, body: "Invalid signature" };
  }

  const payload = JSON.parse(rawBody) as SlackEvent;

  // url_verification チャレンジ（Slack App 設定時に一度だけ送られる）
  if (payload.type === "url_verification") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge: payload.challenge }),
    };
  }

  // app_mention イベントのみ処理
  if (payload.type === "event_callback" && payload.event?.type === "app_mention") {
    const slackEvent = payload.event;

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({
          text: slackEvent.text,
          user: slackEvent.user,
          channel: slackEvent.channel,
          threadTs: slackEvent.thread_ts ?? slackEvent.ts,
        }),
      }),
    );

    return { statusCode: 200, body: "OK" };
  }

  // その他のイベントは無視
  return { statusCode: 200, body: "OK" };
}
