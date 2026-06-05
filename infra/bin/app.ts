import * as cdk from "aws-cdk-lib";
import { AgentStack } from "../lib/agent-stack.js";
import { ScheduleStack } from "../lib/schedule-stack.js";
import { SlackStack } from "../lib/slack-stack.js";

/**
 * CDK App entry point for connpass-scout-agent.
 *
 * Context keys (set in cdk.json or via --context flag):
 *   agentCoreRuntimeArn  — Bedrock AgentCore Runtime ARN.
 *                          PLACEHOLDER: defaults to a dummy ARN; replace before deploying.
 *   digestChannelId      — Slack channel ID for daily digest (scope_id).
 *                          PLACEHOLDER: defaults to "C0123ABC"; replace before deploying.
 */
const app = new cdk.App();

// Destructure env vars: `process.env` is a pure index-signature type, so neither dot
// access (blocked by tsconfig `noPropertyAccessFromIndexSignature`) nor bracket access
// (flagged by Biome `useLiteralKeys`) is clean — destructuring satisfies both linters.
const { AGENT_RUNTIME_ARN, CDK_DEFAULT_ACCOUNT, CDK_DEFAULT_REGION } = process.env;

// Resolve AgentCore Runtime ARN from CDK context → env var → placeholder
const agentCoreRuntimeArn: string =
  (app.node.tryGetContext("agentCoreRuntimeArn") as string | undefined) ??
  // PLACEHOLDER: replace with real Bedrock AgentCore Runtime ARN before deploying
  AGENT_RUNTIME_ARN ??
  "arn:aws:bedrock-agentcore:ap-northeast-1:123456789012:runtime/placeholder-runtime-id";

const digestChannelId: string =
  (app.node.tryGetContext("digestChannelId") as string | undefined) ??
  // PLACEHOLDER: replace with real Slack digest channel ID before deploying
  "C0123ABC";

// Build environment object; with exactOptionalPropertyTypes we must avoid
// setting account to `undefined` explicitly — omit the key if not set.
const cdkAccount = CDK_DEFAULT_ACCOUNT;
const cdkRegion = CDK_DEFAULT_REGION ?? "ap-northeast-1";
const env: cdk.Environment = {
  ...(cdkAccount !== undefined ? { account: cdkAccount } : {}),
  region: cdkRegion,
};

// Stack 1: DynamoDB tables + Bedrock AgentCore Runtime/Memory (L1 placeholders)
const agentStack = new AgentStack(app, "ConnpassScoutAgentStack", {
  env,
  agentCoreRuntimeArn,
  description: "connpass-scout-agent: DynamoDB tables and Bedrock AgentCore resources",
});

// Stack 2: API Gateway, Lambda functions, SQS FIFO queue, Secrets Manager references
const slackStack = new SlackStack(app, "ConnpassScoutSlackStack", {
  env,
  // Cross-stack references: table names from AgentStack
  keywordsTableName: agentStack.keywordsTableName,
  notifiedEventsTableName: agentStack.notifiedEventsTableName,
  agentCoreRuntimeArn: agentStack.agentCoreRuntimeArn,
  description: "connpass-scout-agent: Slack integration (API GW, Lambda, SQS)",
});

// Make SlackStack depend on AgentStack so CDK deploys in the right order
slackStack.addDependency(agentStack);

// Stack 3: EventBridge Scheduler for daily digest
const scheduleStack = new ScheduleStack(app, "ConnpassScoutScheduleStack", {
  env,
  agentCoreRuntimeArn: agentStack.agentCoreRuntimeArn,
  digestChannelId,
  description: "connpass-scout-agent: EventBridge Scheduler for daily digest",
});

// ScheduleStack depends on AgentStack for the runtime ARN
scheduleStack.addDependency(agentStack);

app.synth();
