import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

export interface SlackStackProps extends cdk.StackProps {
  /** Name of the KeywordsTable (from AgentStack). */
  readonly keywordsTableName: string;
  /** Name of the NotifiedEventsTable (from AgentStack). */
  readonly notifiedEventsTableName: string;
  /** Bedrock AgentCore Runtime ARN (from AgentStack). */
  readonly agentCoreRuntimeArn: string;
}

/**
 * SlackStack: API Gateway → verification Lambda → SQS FIFO → agent-integration Lambda.
 *
 * Secrets are referenced via Secret.fromSecretNameV2 (no plaintext values in code or CFN).
 * Lambda code uses Code.fromInline placeholder so cdk synth succeeds without a build step.
 * Real Lambda bundles are produced at deploy time via esbuild / CI pipeline.
 */
export class SlackStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SlackStackProps) {
    super(scope, id, props);

    // -------------------------------------------------------------------------
    // Secrets Manager — reference only (no values stored here)
    // The secrets must be created manually or via separate pipeline before deploy.
    // -------------------------------------------------------------------------
    const slackBotTokenSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "SlackBotTokenSecret",
      "connpass-scout/SLACK_BOT_TOKEN",
    );

    const slackSigningSecretSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "SlackSigningSecretSecret",
      "connpass-scout/SLACK_SIGNING_SECRET",
    );

    // -------------------------------------------------------------------------
    // SQS FIFO Queue
    // Receives Slack events from verification Lambda; consumed by agent-integration Lambda.
    // -------------------------------------------------------------------------
    const slackEventsQueue = new sqs.Queue(this, "SlackEventsQueue", {
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: cdk.Duration.seconds(300),
      retentionPeriod: cdk.Duration.days(1),
    });

    // -------------------------------------------------------------------------
    // verification Lambda
    //
    // Responsibility (§6):
    //   - Verify Slack request signature (HMAC-SHA256, v0= prefix, 5-min replay protection).
    //   - Return challenge for url_verification events immediately.
    //   - Exclude bot_id / subtype=bot_message.
    //   - Send valid events to SQS FIFO.
    //   - Always respond HTTP 200 immediately.
    //
    // NOTE: Code.fromInline is a placeholder so cdk synth succeeds without a build step.
    //       Replace with lambda.Code.fromAsset("lambdas/verification/dist") at deploy time.
    // -------------------------------------------------------------------------
    const verificationFn = new lambda.Function(this, "VerificationFunction", {
      // NOTE: placeholder inline code — real bundled asset used at deploy
      code: lambda.Code.fromInline("exports.handler=async()=>({statusCode:200})"),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(10),
      environment: {
        // §1 environment variable names
        SQS_QUEUE_URL: slackEventsQueue.queueUrl,
        SLACK_SIGNING_SECRET: slackSigningSecretSecret.secretArn, // resolved at runtime via SDK
        SLACK_BOT_TOKEN: slackBotTokenSecret.secretArn, // resolved at runtime via SDK
        KEYWORDS_TABLE_NAME: props.keywordsTableName,
        NOTIFIED_EVENTS_TABLE_NAME: props.notifiedEventsTableName,
        AGENT_RUNTIME_ARN: props.agentCoreRuntimeArn,
      },
    });

    // Grant verification Lambda permission to send messages to the FIFO queue
    slackEventsQueue.grantSendMessages(verificationFn);

    // Grant verification Lambda read access to Secrets Manager secrets
    slackBotTokenSecret.grantRead(verificationFn);
    slackSigningSecretSecret.grantRead(verificationFn);

    // -------------------------------------------------------------------------
    // agent-integration Lambda
    //
    // Responsibility (§6):
    //   - Triggered by SQS FIFO event source.
    //   - Post "処理中…" to Slack, invoke AgentCore Runtime, update Slack message.
    //
    // NOTE: Code.fromInline placeholder — replace with real asset at deploy time.
    // -------------------------------------------------------------------------
    const agentIntegrationFn = new lambda.Function(this, "AgentIntegrationFunction", {
      // NOTE: placeholder inline code — real bundled asset used at deploy
      code: lambda.Code.fromInline("exports.handler=async()=>({statusCode:200})"),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(300),
      environment: {
        // §1 environment variable names
        SQS_QUEUE_URL: slackEventsQueue.queueUrl,
        SLACK_BOT_TOKEN: slackBotTokenSecret.secretArn, // resolved at runtime via SDK
        KEYWORDS_TABLE_NAME: props.keywordsTableName,
        NOTIFIED_EVENTS_TABLE_NAME: props.notifiedEventsTableName,
        AGENT_RUNTIME_ARN: props.agentCoreRuntimeArn,
      },
    });

    // Attach SQS event source to agent-integration Lambda
    agentIntegrationFn.addEventSource(
      new lambdaEventSources.SqsEventSource(slackEventsQueue, {
        batchSize: 1, // process one Slack event at a time to avoid session collisions
        reportBatchItemFailures: true,
      }),
    );

    // Grant agent-integration Lambda permission to consume messages from the FIFO queue
    slackEventsQueue.grantConsumeMessages(agentIntegrationFn);

    // Grant agent-integration Lambda read access to Secrets Manager secrets
    slackBotTokenSecret.grantRead(agentIntegrationFn);

    // Least-privilege IAM: allow agent-integration Lambda to invoke AgentCore Runtime
    agentIntegrationFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock-agentcore:InvokeAgentRuntime"],
        resources: [props.agentCoreRuntimeArn],
        effect: iam.Effect.ALLOW,
      }),
    );

    // -------------------------------------------------------------------------
    // API Gateway REST API
    // POST /slack/events → verification Lambda (Lambda proxy integration)
    // -------------------------------------------------------------------------
    const api = new apigateway.RestApi(this, "SlackApi", {
      restApiName: "connpass-scout-slack-api",
      description: "Receives Slack event callbacks for connpass-scout-agent",
      deployOptions: {
        stageName: "prod",
      },
    });

    const slackResource = api.root.addResource("slack");
    const eventsResource = slackResource.addResource("events");

    eventsResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(verificationFn, {
        proxy: true,
      }),
    );
  }
}
