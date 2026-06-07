import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import { AgentRuntimeStack } from "../stacks/agent-runtime-stack.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

// packages/infra/src/bin -> packages/agent/deploy
// `npm run package --workspace=@connpass-scout-agent/agent` が生成する自己完結ディレクトリ
const agentCodePath = join(moduleDir, "../../../agent/deploy");

const app = new cdk.App();

const account = process.env["CDK_DEFAULT_ACCOUNT"];

new AgentRuntimeStack(app, "ConnpassScoutAgentRuntimeStack", {
  env: {
    ...(account !== undefined ? { account } : {}),
    region: process.env["CDK_DEFAULT_REGION"] ?? "ap-northeast-1",
  },
  agentCodePath,
  connpassApiKeyParameterName: "/connpass-scout-agent/connpass/api-key",
});
