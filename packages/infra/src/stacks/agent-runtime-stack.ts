import * as cdk from "aws-cdk-lib";
import { AgentCoreRuntime, AgentRuntimeArtifact, Runtime } from "aws-cdk-lib/aws-bedrockagentcore";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

export interface AgentRuntimeStackProps extends cdk.StackProps {
  /** デプロイ可能な状態にビルド済みのエージェントコードのディレクトリ(package.json と dist/ を含む) */
  readonly agentCodePath: string;
  /** connpass API キーを格納している SSM SecureString パラメータ名 */
  readonly connpassApiKeyParameterName: string;
  /** Bedrock モデル ID を上書きする場合に指定(省略時はエージェント側の既定値を使用) */
  readonly bedrockModelId?: string;
}

const RUNTIME_NAME = "connpass_scout_agent";

export class AgentRuntimeStack extends cdk.Stack {
  public readonly runtime: Runtime;

  constructor(scope: Construct, id: string, props: AgentRuntimeStackProps) {
    super(scope, id, props);

    const region = cdk.Stack.of(this).region;

    this.runtime = new Runtime(this, "Runtime", {
      runtimeName: RUNTIME_NAME,
      description: "connpass のイベントを興味分野で検索し、日本語で要約して提示するエージェント",
      agentRuntimeArtifact: AgentRuntimeArtifact.fromCodeAsset({
        path: props.agentCodePath,
        runtime: AgentCoreRuntime.NODE_22,
        entrypoint: ["dist/index.js"],
      }),
      environmentVariables: {
        // パラメータ「名」のみを渡し、ランタイム内で SSM から値を取得する。
        // BedrockAgentCore::Runtime は ssm-secure 動的参照をサポートしないため。
        CONNPASS_API_KEY_SSM_NAME: props.connpassApiKeyParameterName,
        BEDROCK_REGION: region,
        ...(props.bedrockModelId !== undefined ? { BEDROCK_MODEL_ID: props.bedrockModelId } : {}),
      },
      tracingEnabled: true,
    });

    // モデル呼び出しは Nova モデルファミリーに限定する(エージェント既定値は
    // global.amazon.nova-2-lite-v1:0 というクロスリージョン推論プロファイル)。
    // 推論プロファイルは複数リージョンの基盤モデルへルーティングされるため、
    // 基盤モデル ARN・推論プロファイル ARN の双方をリージョンワイルドカードで許可する。
    this.runtime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "InvokeNovaModels",
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          `arn:${cdk.Aws.PARTITION}:bedrock:*::foundation-model/amazon.nova-*`,
          `arn:${cdk.Aws.PARTITION}:bedrock:*:${cdk.Aws.ACCOUNT_ID}:inference-profile/*amazon.nova-*`,
        ],
      }),
    );

    // ランタイム内で SSM SecureString から API キーを取得するための権限
    this.runtime.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadConnpassApiKey",
        actions: ["ssm:GetParameter"],
        resources: [
          cdk.Arn.format(
            {
              service: "ssm",
              resource: "parameter",
              resourceName: props.connpassApiKeyParameterName.replace(/^\//, ""),
            },
            this,
          ),
        ],
      }),
    );
  }
}
