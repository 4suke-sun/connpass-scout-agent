import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import type { Construct } from "constructs";

export interface ScheduleStackProps extends cdk.StackProps {
  /** Bedrock AgentCore Runtime ARN to invoke on schedule. */
  readonly agentCoreRuntimeArn: string;
  /**
   * Slack channel ID used as scope_id for the daily digest payload.
   * Defaults to placeholder "C0123ABC" — replace with real channel ID before deploying.
   */
  readonly digestChannelId?: string;
}

/**
 * ScheduleStack: EventBridge Scheduler that triggers daily digest on the AgentCore Runtime.
 *
 * Uses CfnSchedule (L1) because aws-cdk-lib/aws-scheduler provides only CfnSchedule/CfnScheduleGroup
 * at the L1 level; the higher-level L2 Schedule construct lives in the separate
 * @aws-cdk/aws-scheduler-alpha package which is not installed here.
 *
 * Universal target ARN format: arn:aws:scheduler:::aws-sdk:<service>:<action>
 * For Bedrock AgentCore: arn:aws:scheduler:::aws-sdk:bedrockagentcore:invokeAgentRuntime
 *
 * NOTE on runtimeSessionId: Bedrock AgentCore requires runtimeSessionId to be >= 33 characters.
 * The CALLER (this schedule, via the target Input) supplies it — the runtime cannot invent it.
 * We pass a fixed >=33-char session id in the universal-target Input (see below).
 */
export class ScheduleStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ScheduleStackProps) {
    super(scope, id, props);

    const digestChannelId = props.digestChannelId ?? "C0123ABC"; // PLACEHOLDER: replace with real channel ID

    // -------------------------------------------------------------------------
    // IAM Role for EventBridge Scheduler
    // Assumed by scheduler.amazonaws.com, grants least-privilege to invoke AgentCore Runtime.
    // -------------------------------------------------------------------------
    const schedulerRole = new iam.Role(this, "SchedulerRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      description: "Allows EventBridge Scheduler to invoke Bedrock AgentCore Runtime",
      inlinePolicies: {
        InvokeAgentRuntime: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["bedrock-agentcore:InvokeAgentRuntime"],
              resources: [props.agentCoreRuntimeArn],
              effect: iam.Effect.ALLOW,
            }),
          ],
        }),
      },
    });

    // -------------------------------------------------------------------------
    // Universal-target Input = the InvokeAgentRuntime API request parameters.
    //
    // For a Scheduler universal target (arn:aws:scheduler:::aws-sdk:<svc>:<action>),
    // `target.input` is passed AS the SDK call parameters — NOT as the agent payload.
    // InvokeAgentRuntime therefore needs AgentRuntimeArn + RuntimeSessionId + Payload,
    // where Payload is the §2 daily_digest JSON the agent actually receives.
    //
    // runtimeSessionId (§2): Bedrock AgentCore requires >= 33 characters. Scheduler
    // input is a static string, so we use a fixed >=33-char session id below. For
    // per-day Memory isolation, derive it from <aws.scheduler.scheduled-time> instead
    // once the runtimeSessionId charset constraints are confirmed against AWS docs.
    //
    // NOTE: the exact universal-target parameter mapping for bedrockagentcore:
    // invokeAgentRuntime (param casing / payload encoding) cannot be validated without
    // a real deploy — verify against AWS docs before going live. (deploy = out of scope)
    // -------------------------------------------------------------------------
    const runtimeSessionId = "connpass-scout-daily-digest-scheduled-session"; // 45 chars (>= 33)
    const digestPayload = JSON.stringify({
      action: "daily_digest",
      scope_id: digestChannelId,
    });
    const scheduleInput = JSON.stringify({
      AgentRuntimeArn: props.agentCoreRuntimeArn,
      RuntimeSessionId: runtimeSessionId,
      Payload: digestPayload,
    });

    // -------------------------------------------------------------------------
    // CfnSchedule (L1) — daily digest at 09:00 JST
    //
    // Universal target ARN: arn:aws:scheduler:::aws-sdk:bedrockagentcore:invokeAgentRuntime
    // flexibleTimeWindow: OFF (fire at exact time)
    // scheduleExpression: cron(0 9 * * ? *) — every day at 09:00
    // scheduleExpressionTimezone: Asia/Tokyo
    // -------------------------------------------------------------------------
    new scheduler.CfnSchedule(this, "DailyDigestSchedule", {
      name: "connpass-scout-daily-digest",
      description: "Triggers connpass-scout-agent daily digest at 09:00 JST",
      flexibleTimeWindow: {
        mode: "OFF",
      },
      scheduleExpression: "cron(0 9 * * ? *)",
      scheduleExpressionTimezone: "Asia/Tokyo",
      state: "ENABLED",
      target: {
        // Universal target ARN for Bedrock AgentCore invokeAgentRuntime API call via SDK
        arn: "arn:aws:scheduler:::aws-sdk:bedrockagentcore:invokeAgentRuntime",
        roleArn: schedulerRole.roleArn,
        input: scheduleInput,
        // RetryPolicy: default (no retry for daily digest to avoid duplicate posts)
        retryPolicy: {
          maximumRetryAttempts: 0,
        },
      },
    });
  }
}
