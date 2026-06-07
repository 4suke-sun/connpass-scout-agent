import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Construct } from "constructs";

const moduleDir = dirname(fileURLToPath(import.meta.url));

export interface SchedulerStackProps extends cdk.StackProps {
  /** AgentCore Runtime の ARN（AgentRuntimeStack からの出力値を渡す） */
  readonly agentRuntimeArn: string;
  /** Slack Bot Token を格納する SSM SecureString パラメータ名 */
  readonly slackBotTokenParameterName: string;
  /** Slack チャンネル ID（投稿先） */
  readonly slackChannelId: string;
  /** 検索キーワード（カンマ区切り） */
  readonly searchKeywords?: string;
  /** cron 式（UTC）。省略時は JST 9:00 = UTC 0:00 */
  readonly scheduleExpression?: string;
}

export class SchedulerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SchedulerStackProps) {
    super(scope, id, props);

    // --- Lambda Function ---
    const schedulerFn = new NodejsFunction(this, "SchedulerFunction", {
      entry: join(moduleDir, "../handlers/scheduler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: {
        AGENT_RUNTIME_ARN: props.agentRuntimeArn,
        SLACK_BOT_TOKEN_PARAMETER: props.slackBotTokenParameterName,
        SLACK_CHANNEL_ID: props.slackChannelId,
        ...(props.searchKeywords !== undefined ? { SEARCH_KEYWORDS: props.searchKeywords } : {}),
      },
      bundling: {
        format: OutputFormat.ESM,
        target: "node22",
        // @aws-sdk/client-ssm は Lambda ランタイムに含まれるため external にする。
        // @aws-sdk/client-bedrock-agentcore は含まれないため明示的にバンドルする。
        nodeModules: ["@aws-sdk/client-bedrock-agentcore"],
        externalModules: ["@aws-sdk/client-ssm"],
      },
    });

    // AgentCore Runtime 呼び出し権限
    // InvokeAgentRuntime は runtime-endpoint/DEFAULT サブリソースに対しても必要
    schedulerFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "InvokeAgentRuntime",
        actions: ["bedrock-agentcore:InvokeAgentRuntime"],
        resources: [props.agentRuntimeArn, `${props.agentRuntimeArn}/*`],
      }),
    );

    // SSM SecureString 読み取り権限
    schedulerFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadSlackBotToken",
        actions: ["ssm:GetParameter"],
        resources: [
          cdk.Arn.format(
            {
              service: "ssm",
              resource: "parameter",
              resourceName: props.slackBotTokenParameterName.replace(/^\//, ""),
            },
            this,
          ),
        ],
      }),
    );

    // --- EventBridge Scheduler ---
    // CDK L2 の Schedule はまだ experimental のため、EventBridge Rule (cron) を使用。
    // JST 9:00 = UTC 0:00 を既定値とする。
    const cronExpression = props.scheduleExpression ?? "cron(0 0 * * ? *)";

    const rule = new events.Rule(this, "DailyScheduleRule", {
      schedule: events.Schedule.expression(cronExpression),
      description: "connpass-scout-agent 毎朝定期実行 (JST 9:00)",
    });

    rule.addTarget(new targets.LambdaFunction(schedulerFn));

    // --- Outputs ---
    new cdk.CfnOutput(this, "SchedulerFunctionArn", {
      value: schedulerFn.functionArn,
      description: "Scheduler Lambda Function ARN",
    });
  }
}
