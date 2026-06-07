# connpass-scout-agent

> 🚧 **開発中**
>
> 本プロジェクトは現在開発中です。進捗は下記の[ロードマップ](#ロードマップ)を参照してください。

**[English README](../README.md)**

---

`connpass-scout-agent` は、技術コミュニティ向けイベントプラットフォーム [connpass](https://connpass.com/) から
興味分野（キーワード／ハッシュタグ）に合致するイベントを検索し、次の2つの導線で届ける AI エージェントです。

1. **毎朝のダイジェスト配信** — スケジュール実行で毎朝イベントを検索し、Slack チャンネルに要約を投稿
2. **対話的な検索** — Slack でいつでもメンションして、その場で検索・会話形式でやり取り

[Amazon Bedrock AgentCore](https://aws.amazon.com/bedrock/agentcore/) 上で動作する AI エージェントとして、
TypeScript と [Strands Agents SDK](https://strandsagents.com/) を用いて構築しています。

## アーキテクチャ

```
EventBridge Scheduler ──▶ Lambda ──▶ Bedrock AgentCore Runtime ──▶ connpass API v2
  (毎朝 cron)                          (Strands Agent + 検索ツール)      (X-API-Key, 1 req/sec)
                                               │
Slack (@mention) ──▶ API Gateway ──▶ Lambda ──▶ SQS ──▶ Lambda ──▶ (同 Runtime, セッション = スレッドts)
                                                                          │
                                                                          ▼
                                                                  Slack channel / thread
```

インフラは AWS CDK v2 で定義します。秘密情報（connpass API キー、Slack の Bot Token / Signing Secret）は
SSM Parameter Store に `SecureString` として格納し、リポジトリには一切含めません。

## リポジトリ構成

| パス | 役割 |
|------|------|
| `packages/agent/` | エージェント本体 — Bedrock AgentCore Runtime にデプロイ（Strands Agents SDK + connpass API v2 検索ツール） |
| `packages/infra/` | AWS インフラ定義（CDK v2）: AgentCore Runtime, EventBridge Scheduler, Slack連携（API Gateway / Lambda / SQS） |
| `.claude/` | [`ai-auto-dev-framework`](https://github.com/4suke-sun/ai-auto-dev-framework) から継承した Claude Code ガードレール（hooks, skills） |
| `docs/agent-guides/` | このリポジトリでの AI 支援開発のフェーズ別ガイド |

## セルフホスティングについて

本プロジェクトは、**あなた自身の** AWS アカウント・connpass API キー・Slack ワークスペースにデプロイして使うことを
前提としています。作者の認証情報やアカウント情報がリポジトリに含まれることは、設計上ありません。

最初から徹底している原則:

> 実際の認証情報（AWS アカウント情報・アクセスキー、connpass API キー、Slack トークン等）は
> **絶対にコミットしない**。リポジトリに含めて良いのはダミーのプレースホルダー値のみで、
> デプロイ前に各自の値に差し替える。

具体的には:

- `.env.example` にはダミー値のみを記載してコミットし、コピーした `.env`（gitignore済み）に各自の値を設定する
- AWS のアカウント／リージョンは環境変数（`CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION`）から取得し、コードにハードコードしない
- セットアップ手順は「作者の設定例」ではなく「あなた自身の認証情報を取得・設定する手順」として記述する

### デプロイ前に各自で準備するもの

- connpass API v2 キー — connpass の[個人/コミュニティ向け申請フォーム](https://help.connpass.com/api/)から申請（無料）
- Bot Token と Signing Secret を持つ Slack App（`chat:write`, `app_mentions:read`, `commands` などの scope）
- Amazon Bedrock AgentCore が利用できる AWS アカウント（Tokyo/`ap-northeast-1` を含む複数リージョンで提供）

### デプロイ手順（AgentCore Runtime）

1. **SSM Parameter Store に connpass API キーを `SecureString` として登録**

   ```bash
   aws ssm put-parameter \
     --name /connpass-scout-agent/connpass/api-key \
     --type SecureString \
     --value "<あなたの connpass API キー>" \
     --profile <your-profile>
   ```

2. **エージェントのデプロイ用パッケージをビルド**

   AgentCore Runtime の Node.js zip デプロイは npm workspaces のホイスティングに対応していないため、
   `packages/agent/deploy/` に自己完結した `node_modules` を含むデプロイ可能ディレクトリを生成します。

   ```bash
   npm run package --workspace=@connpass-scout-agent/agent
   ```

3. **CDK でデプロイ**

   初回のみ、デプロイ先リージョンに対して `cdk bootstrap` が必要です。

   ```bash
   cd packages/infra
   npx cdk bootstrap --profile <your-profile>
   npx cdk deploy --profile <your-profile>
   ```

   デプロイ先リージョンは AWS CLI プロファイル / `AWS_REGION` の設定から解決されます
   （未設定時は `ap-northeast-1` にフォールバック）。

### スモークテスト

デプロイ完了後に出力される `AgentRuntimeArn` を使い、AWS CLI から直接呼び出して疎通確認できます。

```bash
aws bedrock-agentcore invoke-agent-runtime \
  --agent-runtime-arn "<出力された AgentRuntimeArn>" \
  --payload '{"prompt": "TypeScript の勉強会を探して"}' \
  --content-type application/json \
  --profile <your-profile> \
  /tmp/connpass-scout-agent-response.json \
&& cat /tmp/connpass-scout-agent-response.json
```

`{"reply": "..."}` 形式のレスポンスが返れば成功です。

## ロードマップ

小さく独立してマージ可能な単位で段階的に構築しています:

1. ✅ プロジェクト基盤整備（npm workspaces化、規約整備、CLAUDE.md）
2. ✅ connpass API v2 クライアント（型付き・レート制限対応）
3. ✅ エージェント定義（Strands Agents SDK + connpass検索ツール）
4. ✅ Bedrock AgentCore Runtime へのデプロイ（CDK）
5. 毎朝の定期実行（EventBridge Scheduler → Slack投稿）
6. Slack対話呼び出し（API Gateway → Lambda → SQS → AgentCore）

## 開発

```bash
npm install
npm run lint && npm run typecheck && npm run test && npm run build
```

push 前にこの4つすべてがグリーンであること（lefthook と CI で強制）。

本リポジトリは [`ai-auto-dev-framework`](https://github.com/4suke-sun/ai-auto-dev-framework) の
AI支援開発の規約に従っています。スキル・Human-in-the-Loopゲート・セキュリティポリシー等の詳細は
[CLAUDE.md](../CLAUDE.md) と [docs/agent-guides/](agent-guides/) を参照してください。

## ライセンス

MIT — [LICENSE](../LICENSE) を参照。

サードパーティライセンス: [THIRD_PARTY_LICENSES.json](../THIRD_PARTY_LICENSES.json)
