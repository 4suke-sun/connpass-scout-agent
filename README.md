# connpass-scout-agent

> 🚧 **Work in progress**
>
> This project is under active development. See the [Roadmap](#roadmap) below for current status.

**[日本語版 README はこちら](docs/README.ja.md)**

---

`connpass-scout-agent` searches [connpass](https://connpass.com/) — Japan's tech-community event platform — for events
matching your interests (keywords / hashtags), and delivers them through two channels:

1. **Daily digest** — runs every morning on a schedule and posts a summary to a Slack channel
2. **Interactive search** — mention the bot in Slack anytime to search on demand, with conversational follow-ups

It runs as an AI agent on [Amazon Bedrock AgentCore](https://aws.amazon.com/bedrock/agentcore/), built in TypeScript
with the [Strands Agents SDK](https://strandsagents.com/).

## Architecture

```
EventBridge Scheduler ──▶ Lambda ──▶ Bedrock AgentCore Runtime ──▶ connpass API v2
  (毎朝 cron)                          (Strands Agent + 検索ツール)      (X-API-Key, 1 req/sec)
                                               │
Slack (@mention) ──▶ API Gateway ──▶ Lambda ──▶ SQS ──▶ Lambda ──▶ (同 Runtime, セッション = スレッドts)
                                                                          │
                                                                          ▼
                                                                  Slack channel / thread
```

Infrastructure is defined with AWS CDK v2. Secrets (connpass API key, Slack bot token/signing secret) live in
SSM Parameter Store as `SecureString` — never in the repo.

## Repository layout

| Path | Purpose |
|------|---------|
| `packages/agent/` | The agent itself — deployed to Bedrock AgentCore Runtime (Strands Agents SDK + connpass API v2 search tool) |
| `packages/infra/` | AWS infrastructure (CDK v2): AgentCore Runtime, EventBridge Scheduler, Slack integration (API Gateway / Lambda / SQS) |
| `.claude/` | Claude Code guardrails (hooks, skills) inherited from [`ai-auto-dev-framework`](https://github.com/4suke-sun/ai-auto-dev-framework) |
| `docs/agent-guides/` | Phase-by-phase guides for AI-assisted development on this repo |

## Self-hosting

This project is designed to be deployed to **your own** AWS account, with **your own** connpass API key and Slack
app — never the maintainer's. The core rule, from day one:

> Real credentials (AWS account/keys, connpass API key, Slack tokens) must **never** be committed.
> Only dummy placeholder values belong in the repo; replace them with your own before deploying.

Concretely:

- `.env.example` ships with dummy values — copy it to `.env` (gitignored) and fill in your own
- AWS account/region are read from your environment (`CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION`), never hardcoded
- Setup docs walk through obtaining **your own** credentials, not the author's configuration

### Things you'll need to obtain yourself before deploying

- A connpass API v2 key — apply via connpass's [community/individual application form](https://help.connpass.com/api/) (free for individuals/communities)
- A Slack App with a bot token and signing secret (scopes such as `chat:write`, `app_mentions:read`, `commands`)
- An AWS account with access to Amazon Bedrock AgentCore (available in `ap-northeast-1` / Tokyo, among other regions)

### Deploying (AgentCore Runtime)

1. **Store your connpass API key as a `SecureString` in SSM Parameter Store**

   ```bash
   aws ssm put-parameter \
     --name /connpass-scout-agent/connpass/api-key \
     --type SecureString \
     --value "<your connpass API key>" \
     --profile <your-profile>
   ```

2. **Build the agent's deployable package**

   AgentCore Runtime's Node.js zip deployment doesn't work with npm workspaces' hoisted
   `node_modules`, so this generates a self-contained deployable directory at `packages/agent/deploy/`.

   ```bash
   npm run package --workspace=@connpass-scout-agent/agent
   ```

3. **Deploy with CDK**

   `cdk bootstrap` is only needed once per target region.

   ```bash
   cd packages/infra
   npx cdk bootstrap --profile <your-profile>
   npx cdk deploy --profile <your-profile>
   ```

   The deploy region is resolved from your AWS CLI profile / `AWS_REGION`
   (falls back to `ap-northeast-1` if neither is set).

### Smoke testing

Use the `AgentRuntimeArn` printed after deployment to invoke the runtime directly via the AWS CLI:

```bash
aws bedrock-agentcore invoke-agent-runtime \
  --agent-runtime-arn "<AgentRuntimeArn from the deploy output>" \
  --payload '{"prompt": "Find me a TypeScript meetup"}' \
  --content-type application/json \
  --profile <your-profile> \
  /tmp/connpass-scout-agent-response.json \
&& cat /tmp/connpass-scout-agent-response.json
```

A response shaped like `{"reply": "..."}` means it's working.

## Roadmap

Built in small, independently-mergeable stages:

1. ✅ Project foundation (npm workspaces, conventions, CLAUDE.md)
2. ✅ connpass API v2 client (typed, rate-limited)
3. ✅ Agent definition (Strands Agents SDK + connpass search tool)
4. ✅ Deploy to Bedrock AgentCore Runtime (CDK)
5. Daily scheduled digest (EventBridge Scheduler → Slack)
6. Slack interactive search (API Gateway → Lambda → SQS → AgentCore)

## Development

```bash
npm install
npm run lint && npm run typecheck && npm run test && npm run build
```

All four must be green before any push (enforced by lefthook + CI).

This repo follows the [`ai-auto-dev-framework`](https://github.com/4suke-sun/ai-auto-dev-framework) conventions for
AI-assisted development — see [CLAUDE.md](CLAUDE.md) and [docs/agent-guides/](docs/agent-guides/) for the full
workflow (skills, human-in-the-loop gates, security policy).

## License

MIT — see [LICENSE](LICENSE).

Third-party licenses: [THIRD_PARTY_LICENSES.json](THIRD_PARTY_LICENSES.json)
