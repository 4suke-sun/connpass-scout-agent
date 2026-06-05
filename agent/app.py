"""AgentCore Runtime entrypoint for connpass-scout-agent.

This module is the ONLY file that imports strands / bedrock_agentcore.
Pure business logic lives in agent/tools/*.py and is tested without these deps.

Environment variables (§1):
  CONNPASS_API_KEY               — connpass v2 X-API-Key (required)
  CONNPASS_API_BASE              — default https://connpass.com/api/v2
  CONNPASS_REQUEST_INTERVAL_SEC  — sleep between keyword searches (default 1.0)
  MAX_KEYWORDS                   — per-scope keyword cap (default 10)
  KEYWORDS_TABLE_NAME            — DynamoDB KeywordsTable name (required)
  NOTIFIED_EVENTS_TABLE_NAME     — DynamoDB NotifiedEventsTable name (required)
  NOTIFIED_TTL_DAYS              — TTL for notified records in days (default 30)
  SLACK_BOT_TOKEN                — Slack bot token for digest posting (required for digest)
  SLACK_DIGEST_CHANNEL_ID        — Slack channel for daily digest (required for digest)
  AWS_REGION                     — AWS region
"""

from __future__ import annotations

import json
import os

import boto3
import requests
from strands import Agent
from strands.tools import tool

from tools.connpass import get_upcoming_events as _get_upcoming_events
from tools.connpass import search_connpass_events as _search_connpass_events
from tools.keywords import delete_keyword as _delete_keyword
from tools.keywords import list_keywords as _list_keywords
from tools.keywords import register_keyword as _register_keyword

try:
    from bedrock_agentcore.runtime import BedrockAgentCoreApp
except ImportError:  # pragma: no cover — optional in test environments
    BedrockAgentCoreApp = None  # type: ignore[assignment,misc]

# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------


def _require_env(name: str) -> str:
    val = os.environ.get(name, "")
    if not val:
        raise RuntimeError(f"Required environment variable '{name}' is not set.")
    return val


def _keywords_table():
    region = os.environ.get("AWS_REGION", "ap-northeast-1")
    dynamo = boto3.resource("dynamodb", region_name=region)
    return dynamo.Table(_require_env("KEYWORDS_TABLE_NAME"))


def _notified_table():
    region = os.environ.get("AWS_REGION", "ap-northeast-1")
    dynamo = boto3.resource("dynamodb", region_name=region)
    return dynamo.Table(_require_env("NOTIFIED_EVENTS_TABLE_NAME"))


# ---------------------------------------------------------------------------
# @tool wrappers — thin; all logic in agent/tools/*.py
# ---------------------------------------------------------------------------


@tool
def register_keyword(keyword: str, scope_id: str) -> dict:
    """Register a search keyword for the given Slack channel scope.

    Normalises whitespace, enforces the MAX_KEYWORDS cap, and upserts the
    keyword into DynamoDB KeywordsTable with enabled=True.

    Parameters
    ----------
    keyword:
        The keyword to register (e.g. "AWS", "機械学習").
    scope_id:
        The Slack channel ID that owns this keyword.

    Returns
    -------
    dict
        ``{"ok": True, "keyword": <normalised>}`` on success, or
        ``{"ok": False, "reason": <message>}`` when the cap is exceeded.
    """
    return _register_keyword(
        keyword,
        scope_id,
        table=_keywords_table(),
        max_keywords=int(os.environ.get("MAX_KEYWORDS", "10")),
    )


@tool
def list_keywords(scope_id: str) -> list[dict]:
    """List all registered keywords for a Slack channel scope.

    Parameters
    ----------
    scope_id:
        The Slack channel ID to look up.

    Returns
    -------
    list[dict]
        Each item contains ``scope_id``, ``keyword``, ``created_at``, ``enabled``.
    """
    return _list_keywords(scope_id, table=_keywords_table())


@tool
def delete_keyword(keyword: str, scope_id: str) -> dict:
    """Delete a keyword from a Slack channel scope.

    Parameters
    ----------
    keyword:
        The keyword to remove (whitespace is normalised before deletion).
    scope_id:
        The Slack channel ID that owns this keyword.

    Returns
    -------
    dict
        ``{"ok": True, "keyword": <normalised>, "scope_id": scope_id}``
    """
    return _delete_keyword(keyword, scope_id, table=_keywords_table())


@tool
def search_connpass(keyword: str, count: int = 10) -> list[dict]:
    """Search connpass for upcoming tech events matching *keyword*.

    Calls the connpass v2 REST API and returns formatted event dicts.

    Parameters
    ----------
    keyword:
        Search term (e.g. "AWS re:Invent", "Python").
    count:
        Maximum number of results (1–100, default 10).

    Returns
    -------
    list[dict]
        Each element contains ``event_id``, ``title``, ``url``, ``started_at``,
        ``ended_at``, ``place``, ``address``, ``open_status``, ``accepted``,
        ``limit``, and ``thumbnail_url`` (always ``None``).
    """
    return _search_connpass_events(
        keyword,
        count=count,
        api_key=_require_env("CONNPASS_API_KEY"),
        api_base=os.environ.get("CONNPASS_API_BASE", "https://connpass.com/api/v2"),
    )


@tool
def get_upcoming_events(scope_id: str) -> list[dict]:
    """Return newly discovered connpass events for all enabled keywords in *scope_id*.

    Loads keywords from DynamoDB, searches each via the connpass API (with
    polite rate-limiting), deduplicates against previously notified events,
    persists new event IDs, and returns only the unseen events.

    Parameters
    ----------
    scope_id:
        Slack channel ID used to scope keyword and notification lookups.

    Returns
    -------
    list[dict]
        Newly seen events not yet recorded in NotifiedEventsTable.
    """
    return _get_upcoming_events(
        scope_id,
        api_key=_require_env("CONNPASS_API_KEY"),
        keywords_table=_keywords_table(),
        notified_table=_notified_table(),
        api_base=os.environ.get("CONNPASS_API_BASE", "https://connpass.com/api/v2"),
        interval_sec=float(os.environ.get("CONNPASS_REQUEST_INTERVAL_SEC", "1.0")),
        ttl_days=int(os.environ.get("NOTIFIED_TTL_DAYS", "30")),
    )


# ---------------------------------------------------------------------------
# Strands Agent
# ---------------------------------------------------------------------------

agent = Agent(
    tools=[register_keyword, list_keywords, delete_keyword, search_connpass, get_upcoming_events],
    system_prompt=(
        "You are connpass-scout, an AI assistant that helps users discover upcoming tech events on connpass.com. "
        "You can search for events by keyword, manage per-channel keyword subscriptions, and surface new events "
        "that haven't been notified yet. Always respond in the same language the user used."
    ),
)

# ---------------------------------------------------------------------------
# BedrockAgentCoreApp entrypoint
# ---------------------------------------------------------------------------

if BedrockAgentCoreApp is not None:
    app = BedrockAgentCoreApp()

    @app.entrypoint
    def handler(payload: dict) -> str | None:  # noqa: ANN001
        """Handle AgentCore Runtime invocations per contract §2.

        Supported actions:
          ``chat``         — run the Strands agent on ``payload["text"]`` and
                            return the text response.
          ``daily_digest`` — discover new events for ``payload["scope_id"]``
                            and POST a formatted digest to Slack.
        """
        action = payload.get("action")

        if action == "chat":
            text = payload.get("text", "")
            result = agent(text)
            # Strands Agent returns an AgentResult; extract string representation.
            return str(result)

        if action == "daily_digest":
            scope_id = payload.get("scope_id", "")
            events = _get_upcoming_events(
                scope_id,
                api_key=_require_env("CONNPASS_API_KEY"),
                keywords_table=_keywords_table(),
                notified_table=_notified_table(),
                api_base=os.environ.get("CONNPASS_API_BASE", "https://connpass.com/api/v2"),
                interval_sec=float(os.environ.get("CONNPASS_REQUEST_INTERVAL_SEC", "1.0")),
                ttl_days=int(os.environ.get("NOTIFIED_TTL_DAYS", "30")),
            )
            _post_digest_to_slack(events, scope_id)
            return None

        raise ValueError(f"Unknown action: {action!r}")


def _post_digest_to_slack(events: list[dict], scope_id: str) -> None:
    """POST a formatted digest to Slack via chat.postMessage.

    Treats all values from *events* as untrusted — only accesses known fields.
    """
    token = _require_env("SLACK_BOT_TOKEN")
    channel = _require_env("SLACK_DIGEST_CHANNEL_ID")

    if not events:
        text = "本日の新着イベントはありません。"
    else:
        lines = [f"*本日の新着イベント ({len(events)} 件)*"]
        for ev in events:
            title = str(ev.get("title") or "(タイトル不明)")
            url = str(ev.get("url") or "")
            started_at = str(ev.get("started_at") or "日時未定")
            place = str(ev.get("place") or "場所未定")
            lines.append(f"• <{url}|{title}> — {started_at} @ {place}")
        text = "\n".join(lines)

    resp = requests.post(
        "https://slack.com/api/chat.postMessage",
        headers={"Authorization": f"Bearer {token}"},
        json={"channel": channel, "text": text},
        timeout=10,
    )
    resp.raise_for_status()
    # Treat response as untrusted — only check the ok field.
    data = resp.json()
    if not data.get("ok"):
        raise RuntimeError(f"Slack chat.postMessage failed: {json.dumps(data)[:200]}")
