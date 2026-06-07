import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { SlackIntegrationStack } from "./slack-integration-stack.js";

function synthesizeTemplate(): Template {
  const app = new cdk.App();
  const stack = new SlackIntegrationStack(app, "TestSlackIntegrationStack", {
    env: { account: "123456789012", region: "ap-northeast-1" },
    agentRuntimeArn: "arn:aws:bedrock-agentcore:ap-northeast-1:123456789012:runtime/connpass_scout_agent",
    slackBotTokenParameterName: "/connpass-scout-agent/slack/bot-token",
    slackSigningSecretParameterName: "/connpass-scout-agent/slack/signing-secret",
  });
  return Template.fromStack(stack);
}

describe("SlackIntegrationStack", () => {
  it("スタックを定義する_CloudFormationテンプレートのスナップショットと一致する", () => {
    const template = synthesizeTemplate();
    const json = template.toJSON();

    // NodejsFunction のバンドルは実行ごとにアセットハッシュが変わるため安定化
    for (const resource of Object.values(json.Resources ?? {})) {
      const res = resource as Record<string, unknown>;
      const props = res["Properties"] as Record<string, unknown> | undefined;
      if (props?.["Code"]) {
        const code = props["Code"] as Record<string, unknown>;
        if (code["S3Key"]) {
          code["S3Key"] = "ASSET_HASH_PLACEHOLDER.zip";
        }
      }
    }

    expect(json).toMatchSnapshot();
  });

  it("スタックを定義する_署名検証LambdaがNode22でARM64として定義される", () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Architectures: ["arm64"],
      Timeout: 10,
      MemorySize: 128,
    });
  });

  it("スタックを定義する_処理LambdaがNode22でARM64として定義される", () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Architectures: ["arm64"],
      Timeout: 300,
      MemorySize: 256,
    });
  });

  it("スタックを定義する_SQSキューがDLQ付きで定義される", () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties("AWS::SQS::Queue", {
      VisibilityTimeout: 360,
      RedrivePolicy: Match.objectLike({
        maxReceiveCount: 3,
      }),
    });
  });

  it("スタックを定義する_API Gatewayが定義される", () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties("AWS::ApiGateway::RestApi", {
      Name: "connpass-scout-slack-events",
    });
  });

  it("スタックを定義する_AgentCore呼び出し権限がIAMポリシーに含まれる", () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: "InvokeAgentRuntime",
            Action: "bedrock-agentcore:InvokeAgentRuntime",
            Effect: "Allow",
          }),
        ]),
      },
    });
  });

  it("スタックを定義する_SSM署名シークレット読み取り権限がIAMポリシーに含まれる", () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: "ReadSlackSigningSecret",
            Action: "ssm:GetParameter",
            Effect: "Allow",
          }),
        ]),
      },
    });
  });

  it("スタックを定義する_SQSイベントソースマッピングがバッチサイズ1で定義される", () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 1,
    });
  });
});
