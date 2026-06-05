/**
 * Shared types for lambdas — follows §2 of connpass-scout-contract.md
 */

/** Slack event subtypes */
export type SlackEventSubtype = "bot_message" | "message_changed" | "message_deleted" | string;

/** Slack inner event (message) */
export interface SlackMessageEvent {
  type: string;
  subtype?: SlackEventSubtype;
  text?: string;
  user?: string;
  bot_id?: string;
  ts: string;
  channel?: string;
  thread_ts?: string;
  event_ts?: string;
  channel_type?: string;
}

/** Slack event envelope (outer payload POSTed to the verification lambda) */
export interface SlackEventEnvelope {
  token?: string;
  team_id?: string;
  api_app_id?: string;
  type: "event_callback" | "url_verification";
  event_id?: string;
  event_time?: number;
  event?: SlackMessageEvent;
  /** url_verification challenge */
  challenge?: string;
}

/** Headers passed from API Gateway (lowercased) */
export interface SlackRequestHeaders {
  "x-slack-request-timestamp"?: string;
  "x-slack-signature"?: string;
  "x-slack-retry-num"?: string;
  [key: string]: string | undefined;
}

/**
 * AgentChatPayload — the message placed onto SQS FIFO by verification lambda
 * and consumed by agent-integration lambda. Follows §2 chat action.
 */
export interface AgentChatPayload {
  action: "chat";
  text: string;
  scope_id: string;
  actor_id: string;
  session_id: string;
  /** Slack channel for posting the response */
  channel: string;
  /** Slack thread_ts for threading the reply (= event.thread_ts or event.ts) */
  thread_ts: string;
}
