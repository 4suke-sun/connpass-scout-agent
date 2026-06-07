import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { SchedulerStack } from "./scheduler-stack.js";

function synthesizeTemplate(): Template {
  const app = new cdk.App();
  const stack = new SchedulerStack(app, "TestSchedulerStack", {
    env: { account: "123456789012", region: "ap-northeast-1" },
    agentRuntimeArn: "arn:aws:bedrock-agentcore:ap-northeast-1:123456789012:runtime/connpass_scout_agent",
    slackBotTokenParameterName: "/connpass-scout-agent/slack/bot-token",
    slackChannelId: "C1234567890",
    searchKeywords: "TypeScript,AWS",
  });
  return Template.fromStack(stack);
}

describe("SchedulerStack", () => {
  it("スタックを定義する_CloudFormationテンプレートのスナップショットと一致する", () => {
    const template = synthesizeTemplate();
    const json = template.toJSON();

    // NodejsFunction のバンドルは実行ごとにアセットハッシュが変わるため、
    // S3Key を安定化してからスナップショット比較する
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

  it("スタックを定義する_Lambda関数がNode22ランタイムでARM64アーキテクチャとして定義される", () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Architectures: ["arm64"],
      Timeout: 300,
    });
  });

  it("スタックを定義する_Lambda関数の環境変数にAgentRuntimeARNとSlackパラメータが設定される", () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          AGENT_RUNTIME_ARN: "arn:aws:bedrock-agentcore:ap-northeast-1:123456789012:runtime/connpass_scout_agent",
          SLACK_BOT_TOKEN_PARAMETER: "/connpass-scout-agent/slack/bot-token",
          SLACK_CHANNEL_ID: "C1234567890",
          SEARCH_KEYWORDS: "TypeScript,AWS",
        }),
      },
    });
  });

  it("スタックを定義する_EventBridgeルールがcron式で定義される", () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "cron(0 0 * * ? *)",
      State: "ENABLED",
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

  it("スタックを定義する_SSMパラメータ読み取り権限がIAMポリシーに含まれる", () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: "ReadSlackBotToken",
            Action: "ssm:GetParameter",
            Effect: "Allow",
          }),
        ]),
      },
    });
  });
});
