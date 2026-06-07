import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import { AgentRuntimeStack } from "../stacks/agent-runtime-stack.js";
import { SchedulerStack } from "../stacks/scheduler-stack.js";
import { SlackIntegrationStack } from "../stacks/slack-integration-stack.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

// packages/infra/src/bin -> packages/agent/deploy
// `npm run package --workspace=@connpass-scout-agent/agent` が生成する自己完結ディレクトリ
const agentCodePath = join(moduleDir, "../../../agent/deploy");

const app = new cdk.App();

const account = process.env["CDK_DEFAULT_ACCOUNT"];

const env = {
  ...(account !== undefined ? { account } : {}),
  region: process.env["CDK_DEFAULT_REGION"] ?? "ap-northeast-1",
};

const runtimeStack = new AgentRuntimeStack(app, "ConnpassScoutAgentRuntimeStack", {
  env,
  agentCodePath,
  connpassApiKeyParameterName: "/connpass-scout-agent/connpass/api-key",
});

new SchedulerStack(app, "ConnpassScoutSchedulerStack", {
  env,
  agentRuntimeArn: runtimeStack.runtime.agentRuntimeArn,
  slackBotTokenParameterName: "/connpass-scout-agent/slack/bot-token",
  slackChannelId: app.node.tryGetContext("slackChannelId") ?? "C00000000",
  searchKeywords: app.node.tryGetContext("searchKeywords"),
});

new SlackIntegrationStack(app, "ConnpassScoutSlackIntegrationStack", {
  env,
  agentRuntimeArn: runtimeStack.runtime.agentRuntimeArn,
  slackBotTokenParameterName: "/connpass-scout-agent/slack/bot-token",
  slackSigningSecretParameterName: "/connpass-scout-agent/slack/signing-secret",
});
