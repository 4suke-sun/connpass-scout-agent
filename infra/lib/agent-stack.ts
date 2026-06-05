import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";

/**
 * AgentStack: DynamoDB tables for connpass-scout-agent.
 *
 * NOTE: AWS Bedrock AgentCore Runtime/Gateway/Memory do NOT yet have stable L2 constructs
 * in aws-cdk-lib. They are represented here as CfnResource (L1) with placeholder logical IDs
 * and documented properties. The Runtime ARN is accepted via CDK context key
 * "agentCoreRuntimeArn" (or AGENT_RUNTIME_ARN env) and defaults to a placeholder.
 * Replace with real ARN before deploying.
 */
export interface AgentStackProps extends cdk.StackProps {
  /**
   * ARN of the Bedrock AgentCore Runtime.
   * Accepted via CDK context key "agentCoreRuntimeArn" or environment variable AGENT_RUNTIME_ARN.
   * PLACEHOLDER: set to a real ARN before deploying.
   */
  readonly agentCoreRuntimeArn?: string;
}

export class AgentStack extends cdk.Stack {
  /** DynamoDB table name for keyword registrations (PK: scope_id, SK: keyword). */
  public readonly keywordsTableName: string;

  /** DynamoDB table name for notified events with TTL (PK: event_id, TTL attr: ttl). */
  public readonly notifiedEventsTableName: string;

  /** Bedrock AgentCore Runtime ARN (placeholder until runtime is provisioned). */
  public readonly agentCoreRuntimeArn: string;

  constructor(scope: Construct, id: string, props: AgentStackProps = {}) {
    super(scope, id, props);

    // -------------------------------------------------------------------------
    // KeywordsTable
    // PK: scope_id (S)  SK: keyword (S)
    // Additional attrs: created_at (S, ISO8601), enabled (BOOL)
    // -------------------------------------------------------------------------
    const keywordsTable = new dynamodb.Table(this, "KeywordsTable", {
      partitionKey: { name: "scope_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "keyword", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.keywordsTableName = keywordsTable.tableName;

    // -------------------------------------------------------------------------
    // NotifiedEventsTable
    // PK: event_id (S)
    // Additional attrs: notified_at (S, ISO8601), ttl (N)
    // TTL attribute: "ttl"
    // -------------------------------------------------------------------------
    const notifiedEventsTable = new dynamodb.Table(this, "NotifiedEventsTable", {
      partitionKey: { name: "event_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.notifiedEventsTableName = notifiedEventsTable.tableName;

    // -------------------------------------------------------------------------
    // Bedrock AgentCore Runtime (L1 placeholder)
    //
    // aws-cdk-lib does NOT yet provide stable L2 constructs for:
    //   - AWS::Bedrock::AgentRuntime  (AgentCore Runtime)
    //   - AWS::Bedrock::AgentGateway  (AgentCore Gateway)
    //   - AWS::Bedrock::AgentMemory   (AgentCore Memory)
    //
    // The resources below use CfnResource with a documented placeholder type string.
    // The CloudFormation resource types are provisional / may differ on GA.
    // Replace the type string and properties once AWS publishes the stable CFN schema.
    //
    // The Runtime ARN is resolved from CDK context "agentCoreRuntimeArn" at synth time,
    // falling back to the AGENT_RUNTIME_ARN environment variable, then a hard placeholder.
    // -------------------------------------------------------------------------
    const resolvedRuntimeArn =
      props.agentCoreRuntimeArn ??
      // PLACEHOLDER: replace with real Bedrock AgentCore Runtime ARN before deploying
      "arn:aws:bedrock-agentcore:ap-northeast-1:123456789012:runtime/placeholder-runtime-id";

    this.agentCoreRuntimeArn = resolvedRuntimeArn;

    // L1 placeholder for Bedrock AgentCore Runtime
    // TODO: Replace type string "AWS::Bedrock::AgentRuntime" with the actual CFN type
    //       once it is published in CloudFormation resource provider schemas.
    new cdk.CfnResource(this, "AgentCoreRuntime", {
      // NOTE: This CFN type is a placeholder — it will fail on deploy until replaced.
      type: "AWS::Bedrock::AgentRuntime",
      properties: {
        // Adjust properties to match the real schema when available.
        RuntimeName: "connpass-scout-runtime",
        // RoleArn, ModelId etc. must be supplied at deploy time
      },
    });

    // L1 placeholder for Bedrock AgentCore Memory
    new cdk.CfnResource(this, "AgentCoreMemory", {
      // NOTE: This CFN type is a placeholder — it will fail on deploy until replaced.
      type: "AWS::Bedrock::AgentMemory",
      properties: {
        MemoryName: "connpass-scout-memory",
      },
    });
  }
}
