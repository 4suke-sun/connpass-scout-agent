import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AgentRuntimeStack } from "./agent-runtime-stack.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

// 実際の packages/agent/deploy はビルド成果物のため CI 上に存在しない可能性がある。
// fromCodeAsset はパスの実在を要求するため、固定内容のスタブを参照して決定的にする。
const agentCodeStubPath = join(moduleDir, "../../test/fixtures/agent-code-stub");

function synthesizeTemplate(): Template {
  const app = new cdk.App();
  const stack = new AgentRuntimeStack(app, "TestAgentRuntimeStack", {
    env: { account: "123456789012", region: "ap-northeast-1" },
    agentCodePath: agentCodeStubPath,
    connpassApiKeyParameterName: "/connpass-scout-agent/connpass/api-key",
  });
  return Template.fromStack(stack);
}

describe("AgentRuntimeStack", () => {
  it("スタックを定義する_CloudFormationテンプレートのスナップショットと一致する", () => {
    const template = synthesizeTemplate();

    expect(template.toJSON()).toMatchSnapshot();
  });

  it("スタックを定義する_AgentCoreRuntimeリソースがNode22ランタイムで定義される", () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties("AWS::BedrockAgentCore::Runtime", {
      AgentRuntimeName: "connpass_scout_agent",
    });
  });

  it("スタックを定義する_NovaモデルへのbedrockInvokeModel権限がIAMポリシーに含まれる", () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: "InvokeNovaModels",
            Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
            Effect: "Allow",
          }),
        ]),
      },
    });
  });
});
