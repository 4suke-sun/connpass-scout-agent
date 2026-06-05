"""Pure functions for connpass API v2 access.

No strands / bedrock_agentcore imports — fully unit-testable in isolation.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

import requests as requests_lib

_DEFAULT_API_BASE = "https://connpass.com/api/v2"


def _format_event(raw: dict[str, Any]) -> dict[str, Any]:
    """Map a raw connpass v2 event dict to the contract §4 shape."""
    return {
        "event_id": raw.get("id"),
        "title": raw.get("title"),
        "url": raw.get("event_url"),  # renamed per contract §4
        "started_at": raw.get("started_at"),
        "ended_at": raw.get("ended_at"),
        "place": raw.get("place"),
        "address": raw.get("address"),
        "open_status": raw.get("open_status"),
        "accepted": raw.get("accepted"),
        "limit": raw.get("limit"),
        "thumbnail_url": None,  # connpass API v2 does not expose this; always None per §4
    }


def search_connpass_events(
    keyword: str,
    count: int = 10,
    *,
    api_key: str,
    api_base: str = _DEFAULT_API_BASE,
    session=None,
) -> list[dict]:
    """Search connpass events for *keyword* via the v2 REST API.

    Parameters
    ----------
    keyword:
        Search keyword passed to connpass ``keyword`` query parameter.
    count:
        Maximum number of events to return (``count`` query param, default 10).
    api_key:
        connpass v2 API key sent as ``X-API-Key`` header (required).
    api_base:
        Base URL for the connpass v2 API (default ``https://connpass.com/api/v2``).
    session:
        ``requests.Session``-compatible object.  Pass a custom session or mock in
        tests; defaults to the ``requests`` module itself (which has a compatible
        ``get()`` method).

    Returns
    -------
    list[dict]
        Each element is a formatted event dict matching contract §4.
    """
    if session is None:
        session = requests_lib

    url = f"{api_base.rstrip('/')}/events/"
    headers = {"X-API-Key": api_key}
    # order=2 -> 開催日時順 (ascending by start date) as documented in connpass v2 API.
    # order=1 is "更新日時順" (updated_at desc); order=2 is "開催日時順" (started_at asc).
    # We choose order=2 so consumers see upcoming events first.
    params = {"keyword": keyword, "count": count, "order": 2}

    response = session.get(url, headers=headers, params=params, timeout=10)
    response.raise_for_status()

    # Treat response content as untrusted — only extract expected fields.
    data = response.json()
    raw_events: list[dict] = data.get("events", [])
    return [_format_event(e) for e in raw_events]


def get_upcoming_events(
    scope_id: str,
    *,
    api_key: str,
    keywords_table,
    notified_table,
    api_base: str = _DEFAULT_API_BASE,
    count: int = 10,
    interval_sec: float = 1.0,
    ttl_days: int = 30,
    session=None,
    now: datetime | None = None,
) -> list[dict]:
    """Return newly discovered events for all enabled keywords in *scope_id*.

    The function:
    1. Loads enabled keywords for *scope_id* from *keywords_table*.
    2. Searches each keyword via :func:`search_connpass_events`, sleeping
       ``interval_sec`` seconds **between** requests (not after the last one).
    3. Deduplicates against *notified_table* by ``event_id`` (stored as ``str``).
    4. Returns only the new events and records each in *notified_table* with
       ``notified_at`` (ISO-8601) and ``ttl`` (epoch int = now + ttl_days).

    Parameters
    ----------
    scope_id:
        Slack channel ID used as the partition key in *keywords_table*.
    api_key:
        connpass v2 API key.
    keywords_table:
        boto3 DynamoDB ``Table`` resource for KeywordsTable (§5).
    notified_table:
        boto3 DynamoDB ``Table`` resource for NotifiedEventsTable (§5).
    api_base:
        connpass v2 base URL.
    count:
        Events per keyword search.
    interval_sec:
        Seconds to sleep between successive keyword searches.
    ttl_days:
        Days until a ``notified_table`` record expires via DynamoDB TTL.
    session:
        Injected ``requests.Session`` (for tests).
    now:
        Injected current UTC datetime (for deterministic tests).  Defaults to
        ``datetime.now(timezone.utc)``.

    Returns
    -------
    list[dict]
        Newly seen events (not yet in *notified_table*), in discovery order.
    """
    if now is None:
        now = datetime.now(UTC)

    # --- 1. Load enabled keywords for this scope ---
    response = keywords_table.query(
        KeyConditionExpression="scope_id = :sid",
        ExpressionAttributeValues={":sid": scope_id, ":t": True},
        FilterExpression="enabled = :t",
    )
    keywords: list[str] = [item["keyword"] for item in response.get("Items", [])]

    if not keywords:
        return []

    # --- 2. Search each keyword, sleep BETWEEN requests ---
    all_events: list[dict] = []
    for idx, keyword in enumerate(keywords):
        if idx > 0:
            time.sleep(interval_sec)
        events = search_connpass_events(
            keyword,
            count=count,
            api_key=api_key,
            api_base=api_base,
            session=session,
        )
        all_events.extend(events)

    # --- 3. Dedup: keep only events not already in notified_table ---
    # Use a dict to deduplicate within this batch by event_id as well.
    seen_ids: set[str] = set()
    new_events: list[dict] = []
    ttl_epoch = int((now.timestamp()) + ttl_days * 86400)
    notified_at_iso = now.isoformat()

    for event in all_events:
        event_id_str = str(event["event_id"])
        if event_id_str in seen_ids:
            continue
        seen_ids.add(event_id_str)

        # Check notified_table
        existing = notified_table.get_item(Key={"event_id": event_id_str})
        if "Item" in existing:
            continue  # already notified

        new_events.append(event)
        # --- 4. Record as notified ---
        notified_table.put_item(
            Item={
                "event_id": event_id_str,
                "notified_at": notified_at_iso,
                "ttl": ttl_epoch,
            }
        )

    return new_events
