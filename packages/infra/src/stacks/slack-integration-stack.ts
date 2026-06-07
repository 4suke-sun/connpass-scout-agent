import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

const moduleDir = dirname(fileURLToPath(import.meta.url));

export interface SlackIntegrationStackProps extends cdk.StackProps {
  /** AgentCore Runtime の ARN */
  readonly agentRuntimeArn: string;
  /** Slack Bot Token を格納する SSM SecureString パラメータ名 */
  readonly slackBotTokenParameterName: string;
  /** Slack Signing Secret を格納する SSM SecureString パラメータ名 */
  readonly slackSigningSecretParameterName: string;
}

export class SlackIntegrationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SlackIntegrationStackProps) {
    super(scope, id, props);

    // --- SQS Queue ---
    const dlq = new sqs.Queue(this, "SlackEventsDLQ", {
      retentionPeriod: cdk.Duration.days(14),
    });

    const queue = new sqs.Queue(this, "SlackEventsQueue", {
      visibilityTimeout: cdk.Duration.minutes(6), // Lambda timeout + マージン
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: dlq,
      },
    });

    // --- Lambda: slack-verify (API Gateway → 署名検証 → SQS enqueue) ---
    const verifyFn = new NodejsFunction(this, "SlackVerifyFunction", {
      entry: join(moduleDir, "../handlers/slack-verify.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        SLACK_SIGNING_SECRET_PARAMETER: props.slackSigningSecretParameterName,
        QUEUE_URL: queue.queueUrl,
      },
      bundling: {
        format: OutputFormat.ESM,
        target: "node22",
        externalModules: ["@aws-sdk/client-ssm", "@aws-sdk/client-sqs"],
      },
    });

    // SSM 読み取り権限（Signing Secret）
    verifyFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadSlackSigningSecret",
        actions: ["ssm:GetParameter"],
        resources: [
          cdk.Arn.format(
            {
              service: "ssm",
              resource: "parameter",
              resourceName: props.slackSigningSecretParameterName.replace(/^\//, ""),
            },
            this,
          ),
        ],
      }),
    );

    // SQS 送信権限
    queue.grantSendMessages(verifyFn);

    // --- Lambda: slack-process (SQS → AgentCore invoke → Slack reply) ---
    const processFn = new NodejsFunction(this, "SlackProcessFunction", {
      entry: join(moduleDir, "../handlers/slack-process.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      environment: {
        AGENT_RUNTIME_ARN: props.agentRuntimeArn,
        SLACK_BOT_TOKEN_PARAMETER: props.slackBotTokenParameterName,
      },
      bundling: {
        format: OutputFormat.ESM,
        target: "node22",
        nodeModules: ["@aws-sdk/client-bedrock-agentcore"],
        externalModules: ["@aws-sdk/client-ssm"],
      },
    });

    // SQS トリガー
    processFn.addEventSource(
      new SqsEventSource(queue, {
        batchSize: 1,
      }),
    );

    // AgentCore Runtime 呼び出し権限
    processFn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "InvokeAgentRuntime",
        actions: ["bedrock-agentcore:InvokeAgentRuntime"],
        resources: [props.agentRuntimeArn],
      }),
    );

    // SSM 読み取り権限（Bot Token）
    processFn.addToRolePolicy(
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

    // --- API Gateway ---
    const api = new apigateway.RestApi(this, "SlackEventsApi", {
      restApiName: "connpass-scout-slack-events",
      description: "connpass-scout-agent Slack Event Subscriptions エンドポイント",
      deployOptions: {
        stageName: "prod",
        throttlingRateLimit: 100,
        throttlingBurstLimit: 50,
      },
    });

    const slackResource = api.root.addResource("slack").addResource("events");
    slackResource.addMethod("POST", new apigateway.LambdaIntegration(verifyFn));

    // --- Outputs ---
    new cdk.CfnOutput(this, "SlackEventsEndpoint", {
      value: `${api.url}slack/events`,
      description: "Slack Event Subscriptions に設定する Request URL",
    });

    new cdk.CfnOutput(this, "SlackVerifyFunctionArn", {
      value: verifyFn.functionArn,
    });

    new cdk.CfnOutput(this, "SlackProcessFunctionArn", {
      value: processFn.functionArn,
    });
  }
}
