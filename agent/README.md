# connpass-scout-agent

Strands Agents runtime on Bedrock AgentCore that searches connpass for tech events,
manages per-channel keyword subscriptions in DynamoDB, and posts daily digests to Slack.

## Architecture

```
agent/
├── app.py              # BedrockAgentCoreApp entrypoint + @tool wrappers (imports strands)
└── tools/
    ├── connpass.py     # Pure functions: search_connpass_events, get_upcoming_events
    └── keywords.py     # Pure functions: register_keyword, list_keywords, delete_keyword
```

`tools/*.py` has no strands/bedrock_agentcore dependency — fully testable in isolation.

## Required environment variables

| Variable | Description | Default |
|---|---|---|
| `CONNPASS_API_KEY` | connpass v2 `X-API-Key` | required |
| `CONNPASS_API_BASE` | connpass v2 base URL | `https://connpass.com/api/v2` |
| `CONNPASS_REQUEST_INTERVAL_SEC` | sleep between keyword searches (s) | `1.0` |
| `MAX_KEYWORDS` | max keywords per scope | `10` |
| `KEYWORDS_TABLE_NAME` | DynamoDB KeywordsTable name | required |
| `NOTIFIED_EVENTS_TABLE_NAME` | DynamoDB NotifiedEventsTable name | required |
| `NOTIFIED_TTL_DAYS` | notified-record TTL (days) | `30` |
| `SLACK_BOT_TOKEN` | Slack bot token (daily_digest action) | required for digest |
| `SLACK_DIGEST_CHANNEL_ID` | Slack channel for digest posts | required for digest |
| `AWS_REGION` | AWS region | `ap-northeast-1` |

Copy `.env.example` to `.env` and fill in values (`.env` is gitignored).

## Local run

```bash
cd agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Set env vars (never hardcode secrets)
export CONNPASS_API_KEY=...
export KEYWORDS_TABLE_NAME=...
export NOTIFIED_EVENTS_TABLE_NAME=...

python app.py
```

`app.py` builds the Strands Agent and registers the BedrockAgentCoreApp entrypoint.
In production the AgentCore Runtime invokes the `handler` function with a JSON payload
(see contract §2 for `chat` and `daily_digest` actions).

## Running tests

Tests use a separate venv that does **not** install strands/bedrock_agentcore;
they only test `tools/*.py` pure functions.

```bash
cd agent
source .venv/bin/activate   # uses requirements-dev.txt deps

# Lint + format
ruff format .
ruff check .
ruff format --check .

# Unit tests (moto for DynamoDB, requests-mock for HTTP)
python -m pytest -v
```

All tests run offline — no AWS credentials or connpass API key needed.

## DynamoDB table schemas

**KeywordsTable** — PK: `scope_id` (S), SK: `keyword` (S)
- `created_at` (S, ISO-8601), `enabled` (BOOL), billing: PAY_PER_REQUEST

**NotifiedEventsTable** — PK: `event_id` (S)
- `notified_at` (S, ISO-8601), `ttl` (N, epoch int), TTL attr: `ttl`, billing: PAY_PER_REQUEST
