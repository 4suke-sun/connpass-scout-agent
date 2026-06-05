# connpass-scout-agent — 実装インターフェース契約

> 並行実装する各コンポーネント（agent / lambdas / infra）が噛み合うための単一の契約。
> ここに書かれた名前・形・型は **全コンポーネント共通**。勝手に変えない。変更が必要なら lead に相談。

## 1. 環境変数（共通名）

| 変数名 | 用途 | 使う場所 | デフォルト |
|---|---|---|---|
| `CONNPASS_API_KEY` | connpass v2 `X-API-Key` | agent | （必須） |
| `CONNPASS_API_BASE` | connpass v2 ベースURL | agent | `https://connpass.com/api/v2` |
| `CONNPASS_REQUEST_INTERVAL_SEC` | ループ検索の各リクエスト間ウェイト（秒） | agent | `1.0` |
| `MAX_KEYWORDS` | 1 scope あたり登録上限 | agent | `10` |
| `KEYWORDS_TABLE_NAME` | KeywordsTable 名 | agent, infra | — |
| `NOTIFIED_EVENTS_TABLE_NAME` | NotifiedEventsTable 名 | agent, infra | — |
| `NOTIFIED_TTL_DAYS` | 通知済みレコードの TTL（日） | agent | `30` |
| `SLACK_BOT_TOKEN` | Slack Bot Token（Secrets Manager 由来） | agent(digest投稿), lambdas | — |
| `SLACK_SIGNING_SECRET` | Slack 署名検証用 | verification lambda | — |
| `SLACK_DIGEST_CHANNEL_ID` | 日次配信先チャンネル | agent(digest) | — |
| `AGENT_RUNTIME_ARN` | AgentCore Runtime ARN | agent-integration lambda, infra | — |
| `SQS_QUEUE_URL` | FIFO キュー URL | verification/sqs lambda | — |
| `AWS_REGION` | リージョン | all | — |

シークレット（`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `CONNPASS_API_KEY`）は **Secrets Manager** 格納が本番前提。
コードにハードコードしない。ローカルテストでは環境変数 / モックを使う。

## 2. AgentCore Runtime ペイロード契約

`invoke_agent_runtime()` の `payload`（JSON）。`action` で分岐。

### 対話モード（lambda → runtime）
```json
{
  "action": "chat",
  "text": "AWSのイベントある？",
  "scope_id": "C0123ABC",      // = Slack channel_id
  "actor_id": "U0456DEF",      // = Slack user_id
  "session_id": "<slack thread ts based>"
}
```
runtime は **テキスト応答（string）** を返す。Slack への投稿/更新は agent-integration lambda 側が行う。

### スケジュールモード（EventBridge Scheduler → runtime 直接）
```json
{
  "action": "daily_digest",
  "scope_id": "C0123ABC"
}
```
runtime 自身が `get_upcoming_events` を実行し、結果を `SLACK_DIGEST_CHANNEL_ID` へ `chat.postMessage` で **能動投稿**する（lambda を介さない）。

### runtimeSessionId
- 対話: Slack thread ts ベース（lambda が生成）。
- スケジュール: `scheduled-{YYYYMMDD}` 形式。**注意: bedrock-agentcore の runtimeSessionId は最小33文字**。短い場合は末尾パディングして 33 文字以上にする（例: `scheduled-20260605` を 33 文字までゼロ埋め）。

## 3. ツール（Strands `@tool`）と純粋ロジックの分離

テスト容易性のため、**ツールの本体ロジックは strands に依存しない純関数**として `agent/tools/*.py` に置く。
`agent/app.py` で `@tool` デコレータの薄いラッパを定義して純関数を呼ぶ。
→ 単体テストは純関数だけを import する（strands / bedrock-agentcore をテスト時に import しない）。

### connpass.py（純関数シグネチャ）
```python
def search_connpass_events(keyword: str, count: int = 10, *, api_key: str,
                           api_base: str = ..., session=None) -> list[dict]: ...

def get_upcoming_events(scope_id: str, *, api_key: str, keywords_table, notified_table,
                        api_base: str = ..., count: int = 10, interval_sec: float = 1.0,
                        ttl_days: int = 30, session=None, now=None) -> list[dict]: ...
```
- `session` は `requests.Session` 互換（テストで差し替え）。
- `now` は `datetime` 注入（テスト決定化）。省略時 `datetime.now(timezone.utc)`。
- `get_upcoming_events`: 登録キーワード（enabled のみ）を順に検索、各リクエスト間に `interval_sec` ウェイト、`notified_table` で `event_id` 重複除外、新規分のみ返却＋ `notified_table` に `ttl` 付き記録。

### keywords.py（純関数シグネチャ）
```python
def register_keyword(keyword: str, scope_id: str, *, table, max_keywords: int = 10, now=None) -> dict: ...
def list_keywords(scope_id: str, *, table) -> list[dict]: ...
def delete_keyword(keyword: str, scope_id: str, *, table) -> dict: ...
```
- `table` は boto3 DynamoDB `Table` リソース互換（テストは moto で実テーブルを注入）。
- `register_keyword`: 上限 `max_keywords` 超過時はエラー dict（例外でなく `{"ok": False, "reason": ...}`）。空白正規化・重複は upsert。

## 4. 整形済みイベントの形（ツール出力の各要素）
```python
{
  "event_id": int,
  "title": str,
  "url": str,            # event_url
  "started_at": str|None,
  "ended_at": str|None,
  "place": str|None,
  "address": str|None,
  "open_status": str|None,
  "accepted": int|None,
  "limit": int|None,
  "thumbnail_url": None  # connpass API では取得不可。常に None
}
```
connpass v2 `GET /events/` レスポンスの `events[]` のフィールド名: `id`, `title`, `event_url`, `started_at`, `ended_at`, `place`, `address`, `open_status`, `accepted`, `limit`。

## 5. DynamoDB テーブル

### KeywordsTable
- PK: `scope_id` (S), SK: `keyword` (S)
- 属性: `created_at` (S, ISO8601), `enabled` (BOOL)
- 課金: PAY_PER_REQUEST

### NotifiedEventsTable
- PK: `event_id` (S)
- 属性: `notified_at` (S, ISO8601), `ttl` (N)
- TTL 属性名: `ttl`、PAY_PER_REQUEST

## 6. Lambda（TypeScript / Node 22 / ESM）契約

- `verification`: API Gateway proxy 入力。Slack 署名（`v0=HMAC-SHA256(signing_secret, "v0:"+ts+":"+body)`）検証、`x-slack-request-timestamp` の 5 分リプレイ拒否。`url_verification` の `challenge` を即返す。検証 OK なら SQS FIFO へ投入し **即 200**。
- `sqs-integration`: 役割分担として verification が直接 SQS 投入する構成なら、本関数は「Slack event の正規化・bot 自身のメッセージ無視（`bot_id` / `subtype=bot_message` を弾く）」を担当。重複: Slack の `x-slack-retry-num` を無視（200即返し済みなので再送は捨てる）。
  - 実装簡潔化のため: **verification = 署名検証＋即200＋SQS投入**、**sqs-integration = SQS トリガで受け、bot自己メッセージ除外＆正規化して agent-integration を呼ぶ**、ではなく **agent-integration が SQS トリガ**にする 2 段構成にする。下記参照。
- アーキテクチャ確定（迷い防止）:
  1. `verification` (API GW trigger): 署名検証 → bot自己メッセージ/retry 除外 → `chat.postMessage("処理中…")` はしない → SQS FIFO 投入 → 200。
  2. `agent-integration` (SQS trigger): メッセージ受信 → `chat.postMessage("🔍 処理中…")` → `invoke_agent_runtime(payload=chat)` → 応答テキストで `chat.update`。
  - `sqs-integration` フォルダは作るが、bot自己メッセージ判定など共通正規化ユーティリティ `lambdas/shared/slack.ts` に集約し、verification から使う。（独立 lambda を増やさず shared に寄せる）
- Slack 呼び出し: `fetch`（Node 22 グローバル）で `https://slack.com/api/chat.postMessage` / `chat.update`。`Authorization: Bearer ${SLACK_BOT_TOKEN}`。
- AgentCore 呼び出し: `@aws-sdk/client-bedrock-agentcore` の `InvokeAgentRuntimeCommand`（`agentRuntimeArn`, `runtimeSessionId`, `payload`=UTF-8 bytes）。
- SQS: `@aws-sdk/client-sqs` `SendMessageCommand`（FIFO: `MessageGroupId`, `MessageDeduplicationId`）。
- すべてのハンドラは依存（SQS/Slack/AgentCore クライアント, env）を **注入可能**に設計し、`aws-sdk-client-mock` と `fetch` モックで単体テストする。

## 7. infra（AWS CDK / TypeScript）契約

- `infra/bin/app.ts` がエントリ。3 スタック。
- `agent-stack.ts`: KeywordsTable / NotifiedEventsTable（上記スキーマ, TTL=`ttl`）。AgentCore Runtime/Gateway/Memory は L1 (`CfnResource`) もしくはコメントで明示（高レベル construct 未提供のため）。デプロイはしないので **synth が通ればよい**。
- `slack-stack.ts`: API Gateway (REST) → verification Lambda、SQS FIFO、agent-integration Lambda（SQS event source）、Secrets Manager（`SLACK_BOT_TOKEN`/`SLACK_SIGNING_SECRET` 参照のみ＝`Secret.fromSecretNameV2`）。Lambda の env は §1 準拠。
- `schedule-stack.ts`: EventBridge Scheduler。**ユニバーサルターゲット**で `arn:aws:scheduler:::aws-sdk:bedrockagentcore:invokeAgentRuntime`（universal target ARN 形式 `arn:aws:scheduler:::aws-sdk:<service>:<action>`）。`flexibleTimeWindow` OFF。`scheduleExpressionTimezone: "Asia/Tokyo"`、`scheduleExpression: "cron(0 9 * * ? *)"`。Input は §2 daily_digest。実行ロールに `bedrock-agentcore:InvokeAgentRuntime` を付与。
- テスト: `aws-cdk-lib/assertions` の `Template.fromStack` で主要リソース存在をアサート（vitest）。`cdk synth` も通すこと。

## 8. テスト/品質ゲート
- Python: `ruff check` / `ruff format --check` / `pytest`（agent/）。
- TS: `npm run lint`（Biome）/ `npm run typecheck`（tsconfig.app.json 含む）/ `npm run test`（vitest, lambdas+infra）。
- カバレッジ閾値（既存 vitest.config）: lines/statements 50%, branches 40%, functions 50%。
- secrets を絶対にコミットしない。`.env` はコミット禁止（`.env.example` のみ）。

## 9. 既知の未対応事項（デプロイ前に要対応 / 今回スコープ外）

ローカルテストでは検証できない・デプロイ時に対応すべき項目。レビューで検出済み、追跡用に明記する。

- **[要対応] Lambda のシークレット解決（M1）**: `slack-stack.ts` は `SLACK_BOT_TOKEN` /
  `SLACK_SIGNING_SECRET` を Secret の **ARN** として env に渡すが、ハンドラはそれを値として
  直接使う実装になっている。本番では Lambda 内で Secrets Manager SDK から値を取得
  （+キャッシュ）し、`secret.grantRead(fn)` を付与する必要がある。未対応だと署名検証が
  必ず失敗する。ローカルテストは env に値を直接入れるため影響なし。
- **[要対応] AgentCore リソースの L1 プレースホルダ**: `agent-stack.ts` の AgentCore
  Runtime / Memory は安定した CFN スキーマ未公開のため `CfnResource` プレースホルダ。
  実デプロイ前に正式な型・プロパティへ差し替えること。
- **[要確認] Scheduler ユニバーサルターゲットの入力マッピング（B1）**: `invokeAgentRuntime`
  の正確なパラメータ名・Payload エンコード（base64 等）はデプロイなしでは検証不可。
  AWS ドキュメントで確認のうえ調整すること。`RuntimeSessionId` は現状固定値（≥33文字）で、
  日次の Memory 分離が必要なら `<aws.scheduler.scheduled-time>` 由来へ変更（文字種制約に注意）。
- **[改善] `app.py` の digest 経路は未テスト（N2）**: `_post_digest_to_slack` の整形ロジックを
  `tools/` 側の純関数へ切り出してテストすると堅牢。
- **[改善] `runtimeSessionId` のパディング方式**: 対話モードは lambda 側 `toSessionId()` で
  パディング、スケジュールは固定値。命名規則を統一すると分かりやすい。
</content>
</invoke>
