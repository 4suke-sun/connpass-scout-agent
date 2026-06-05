import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { AgentStack } from "../lib/agent-stack.js";
import { ScheduleStack } from "../lib/schedule-stack.js";
import { SlackStack } from "../lib/slack-stack.js";

const PLACEHOLDER_RUNTIME_ARN = "arn:aws:bedrock-agentcore:ap-northeast-1:123456789012:runtime/placeholder-runtime-id";

// ---------------------------------------------------------------------------
// Helpers: build a minimal CDK app and all three stacks
// ---------------------------------------------------------------------------
function buildStacks() {
  const app = new cdk.App();

  const agentStack = new AgentStack(app, "TestAgentStack", {
    agentCoreRuntimeArn: PLACEHOLDER_RUNTIME_ARN,
  });

  const slackStack = new SlackStack(app, "TestSlackStack", {
    keywordsTableName: agentStack.keywordsTableName,
    notifiedEventsTableName: agentStack.notifiedEventsTableName,
    agentCoreRuntimeArn: agentStack.agentCoreRuntimeArn,
  });

  const scheduleStack = new ScheduleStack(app, "TestScheduleStack", {
    agentCoreRuntimeArn: PLACEHOLDER_RUNTIME_ARN,
    digestChannelId: "C0123TEST",
  });

  return { agentStack, slackStack, scheduleStack };
}

// ---------------------------------------------------------------------------
// AgentStack
// ---------------------------------------------------------------------------
describe("AgentStack", () => {
  const { agentStack } = buildStacks();
  const template = Template.fromStack(agentStack);

  it("creates 2 DynamoDB tables", () => {
    template.resourceCountIs("AWS::DynamoDB::Table", 2);
  });

  it("KeywordsTable has correct key schema (PK scope_id, SK keyword)", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [
        { AttributeName: "scope_id", KeyType: "HASH" },
        { AttributeName: "keyword", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "scope_id", AttributeType: "S" },
        { AttributeName: "keyword", AttributeType: "S" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("NotifiedEventsTable has correct key schema (PK event_id) and TTL on 'ttl'", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [{ AttributeName: "event_id", KeyType: "HASH" }],
      AttributeDefinitions: [{ AttributeName: "event_id", AttributeType: "S" }],
      BillingMode: "PAY_PER_REQUEST",
      TimeToLiveSpecification: {
        AttributeName: "ttl",
        Enabled: true,
      },
    });
  });

  it("exposes keywordsTableName as a non-empty string", () => {
    expect(agentStack.keywordsTableName).toBeTruthy();
  });

  it("exposes notifiedEventsTableName as a non-empty string", () => {
    expect(agentStack.notifiedEventsTableName).toBeTruthy();
  });

  it("exposes agentCoreRuntimeArn equal to the placeholder", () => {
    expect(agentStack.agentCoreRuntimeArn).toBe(PLACEHOLDER_RUNTIME_ARN);
  });
});

// ---------------------------------------------------------------------------
// SlackStack
// ---------------------------------------------------------------------------
describe("SlackStack", () => {
  const { slackStack } = buildStacks();
  const template = Template.fromStack(slackStack);

  it("creates an SQS FIFO queue", () => {
    template.hasResourceProperties("AWS::SQS::Queue", {
      FifoQueue: true,
    });
  });

  it("creates exactly one SQS queue", () => {
    template.resourceCountIs("AWS::SQS::Queue", 1);
  });

  it("creates exactly 2 Lambda functions (verification + agent-integration)", () => {
    template.resourceCountIs("AWS::Lambda::Function", 2);
  });

  it("creates a REST API (API Gateway)", () => {
    template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
  });

  it("REST API is named connpass-scout-slack-api", () => {
    template.hasResourceProperties("AWS::ApiGateway::RestApi", {
      Name: "connpass-scout-slack-api",
    });
  });

  it("Lambda functions use NODEJS_22_X runtime", () => {
    const lambdas = template.findResources("AWS::Lambda::Function");
    const runtimes = Object.values(lambdas).map((r) => (r as { Properties: { Runtime: string } }).Properties.Runtime);
    expect(runtimes.every((r) => r === "nodejs22.x")).toBe(true);
  });

  it("agent-integration Lambda has IAM policy allowing bedrock-agentcore:InvokeAgentRuntime", () => {
    // The default policy for agent-integration contains multiple statements (SQS + Secrets + AgentCore).
    // Use Match.arrayWith to assert the specific statement is present without requiring an exact match.
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "bedrock-agentcore:InvokeAgentRuntime",
            Effect: "Allow",
          }),
        ]),
      },
    });
  });
});

// ---------------------------------------------------------------------------
// ScheduleStack
// ---------------------------------------------------------------------------
describe("ScheduleStack", () => {
  const { scheduleStack } = buildStacks();
  const template = Template.fromStack(scheduleStack);

  it("creates exactly one CfnSchedule", () => {
    template.resourceCountIs("AWS::Scheduler::Schedule", 1);
  });

  it("schedule expression timezone is Asia/Tokyo", () => {
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      ScheduleExpressionTimezone: "Asia/Tokyo",
    });
  });

  it("schedule expression is cron(0 9 * * ? *)", () => {
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      ScheduleExpression: "cron(0 9 * * ? *)",
    });
  });

  it("target ARN contains invokeAgentRuntime (universal target format)", () => {
    const schedules = template.findResources("AWS::Scheduler::Schedule");
    const targetArns = Object.values(schedules).map(
      (r) => (r as { Properties: { Target: { Arn: string } } }).Properties.Target.Arn,
    );
    expect(targetArns.some((arn) => arn.includes("invokeAgentRuntime"))).toBe(true);
  });

  it("target Input carries the InvokeAgentRuntime API params (ARN, >=33-char session id, daily_digest payload)", () => {
    const schedules = template.findResources("AWS::Scheduler::Schedule");
    const inputs = Object.values(schedules).map(
      (r) => (r as { Properties: { Target: { Input: string } } }).Properties.Target.Input,
    );
    expect(inputs).toHaveLength(1);
    // CfnSchedule renders Input as a token-joined string; parse it back out.
    const raw = inputs[0] as string;
    const parsed = JSON.parse(raw) as { AgentRuntimeArn?: unknown; RuntimeSessionId?: string; Payload?: string };
    // AgentRuntimeArn must be present (it may be a CFN token object when cross-referenced).
    expect(parsed.AgentRuntimeArn).toBeDefined();
    expect(typeof parsed.RuntimeSessionId).toBe("string");
    expect((parsed.RuntimeSessionId as string).length).toBeGreaterThanOrEqual(33);
    expect(parsed.Payload).toBeDefined();
    const payload = JSON.parse(parsed.Payload as string) as { action: string; scope_id: string };
    expect(payload.action).toBe("daily_digest");
  });

  it("flexibleTimeWindow mode is OFF", () => {
    template.hasResourceProperties("AWS::Scheduler::Schedule", {
      FlexibleTimeWindow: { Mode: "OFF" },
    });
  });

  it("creates an IAM role for the scheduler", () => {
    template.resourceCountIs("AWS::IAM::Role", 1);
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: { Service: "scheduler.amazonaws.com" },
          },
        ],
      },
    });
  });

  it("scheduler IAM policy allows bedrock-agentcore:InvokeAgentRuntime", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      Policies: [
        {
          PolicyName: "InvokeAgentRuntime",
          PolicyDocument: {
            Statement: [
              {
                Action: "bedrock-agentcore:InvokeAgentRuntime",
                Effect: "Allow",
              },
            ],
          },
        },
      ],
    });
  });
});
